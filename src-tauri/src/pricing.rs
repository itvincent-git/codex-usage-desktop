use crate::types::ModelUsage;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

const LITELLM_PRICING_URL: &str =
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const MILLION: f64 = 1_000_000.0;
const PROVIDER_PREFIXES: [&str; 3] = ["openai/", "azure/", "openrouter/openai/"];
const CODEX_MODEL_PREFIXES: [&str; 5] = [
    "gpt-5",
    "gpt-5-",
    "openai/gpt-5",
    "azure/gpt-5",
    "openrouter/openai/gpt-5",
];

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pricing {
    pub input_cost_per_m_token: f64,
    pub cached_input_cost_per_m_token: f64,
    pub output_cost_per_m_token: f64,
}

#[derive(Debug, Clone)]
pub struct PricingSource {
    pricing: BTreeMap<String, LiteLlmModelPricing>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
struct LiteLlmModelPricing {
    input_cost_per_token: Option<f64>,
    cache_read_input_token_cost: Option<f64>,
    output_cost_per_token: Option<f64>,
}

impl PricingSource {
    pub fn load(cache_path: Option<PathBuf>) -> Self {
        let pricing = load_remote_pricing()
            .inspect(|pricing| {
                if let Some(path) = cache_path.as_deref() {
                    let _ = write_cache(path, pricing);
                }
            })
            .or_else(|_| {
                cache_path
                    .as_deref()
                    .ok_or_else(|| "Pricing cache path missing".to_string())
                    .and_then(read_cache)
            })
            .unwrap_or_else(|_| embedded_pricing());

        Self { pricing }
    }

    #[cfg(test)]
    pub fn embedded() -> Self {
        Self {
            pricing: embedded_pricing(),
        }
    }

    #[cfg(test)]
    fn from_pricing(pricing: BTreeMap<String, LiteLlmModelPricing>) -> Self {
        Self { pricing }
    }

    pub fn pricing_for_model(&self, model: &str) -> Pricing {
        if is_openrouter_free_model(model) {
            return Pricing::free();
        }

        let mut pricing = self.lookup_model_pricing(model);
        if let Some(alias) = alias_for_model(model) {
            if pricing
                .as_ref()
                .map(|pricing| !pricing.has_non_zero_token_pricing())
                .unwrap_or(true)
            {
                let alias_pricing = self.lookup_model_pricing(alias);
                if alias_pricing
                    .as_ref()
                    .map(|pricing| pricing.has_non_zero_token_pricing())
                    .unwrap_or(false)
                {
                    pricing = alias_pricing;
                }
            }
        }

        pricing
            .map(Pricing::from_litellm)
            .unwrap_or_else(Pricing::free)
    }

    fn lookup_model_pricing(&self, model: &str) -> Option<&LiteLlmModelPricing> {
        let mut candidates = Vec::with_capacity(PROVIDER_PREFIXES.len() + 1);
        candidates.push(model.to_string());
        for prefix in PROVIDER_PREFIXES {
            candidates.push(format!("{prefix}{model}"));
        }

        for candidate in candidates {
            if let Some(pricing) = self.pricing.get(&candidate) {
                return Some(pricing);
            }
        }

        let lower = model.to_lowercase();
        self.pricing.iter().find_map(|(key, pricing)| {
            let comparison = key.to_lowercase();
            if comparison.contains(&lower) || lower.contains(&comparison) {
                Some(pricing)
            } else {
                None
            }
        })
    }
}

impl Pricing {
    fn free() -> Self {
        Self {
            input_cost_per_m_token: 0.0,
            cached_input_cost_per_m_token: 0.0,
            output_cost_per_m_token: 0.0,
        }
    }

    fn from_litellm(pricing: &LiteLlmModelPricing) -> Self {
        Self {
            input_cost_per_m_token: to_per_million(pricing.input_cost_per_token, None),
            cached_input_cost_per_m_token: to_per_million(
                pricing.cache_read_input_token_cost,
                pricing.input_cost_per_token,
            ),
            output_cost_per_m_token: to_per_million(pricing.output_cost_per_token, None),
        }
    }
}

impl LiteLlmModelPricing {
    fn has_non_zero_token_pricing(&self) -> bool {
        self.input_cost_per_token.unwrap_or(0.0) > 0.0
            || self.output_cost_per_token.unwrap_or(0.0) > 0.0
            || self.cache_read_input_token_cost.unwrap_or(0.0) > 0.0
    }
}

pub fn calculate_cost_usd(usage: &ModelUsage, pricing: Pricing) -> f64 {
    let cached_input = usage.cached_input_tokens.min(usage.input_tokens).max(0) as f64;
    let non_cached_input = (usage.input_tokens - usage.cached_input_tokens).max(0) as f64;
    let output = usage.output_tokens.max(0) as f64;

    non_cached_input / MILLION * pricing.input_cost_per_m_token
        + cached_input / MILLION * pricing.cached_input_cost_per_m_token
        + output / MILLION * pricing.output_cost_per_m_token
}

fn load_remote_pricing() -> Result<BTreeMap<String, LiteLlmModelPricing>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(LITELLM_PRICING_URL)
        .send()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Failed to fetch pricing data: {}",
            response.status()
        ));
    }

    let raw = response
        .json::<BTreeMap<String, serde_json::Value>>()
        .map_err(|error| error.to_string())?;
    Ok(filter_codex_pricing(raw))
}

fn filter_codex_pricing(
    raw: BTreeMap<String, serde_json::Value>,
) -> BTreeMap<String, LiteLlmModelPricing> {
    raw.into_iter()
        .filter_map(|(model, value)| {
            if !is_codex_model(&model) {
                return None;
            }

            serde_json::from_value::<LiteLlmModelPricing>(value)
                .ok()
                .map(|pricing| (model, pricing))
        })
        .collect()
}

fn read_cache(path: &Path) -> Result<BTreeMap<String, LiteLlmModelPricing>, String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

fn write_cache(path: &Path, pricing: &BTreeMap<String, LiteLlmModelPricing>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string(pricing).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn embedded_pricing() -> BTreeMap<String, LiteLlmModelPricing> {
    [
        ("gpt-5", 1.25e-6, 1.25e-7, 1.0e-5),
        ("gpt-5.1", 1.25e-6, 1.25e-7, 1.0e-5),
        ("gpt-5.2", 1.75e-6, 1.75e-7, 1.4e-5),
        ("gpt-5.2-codex", 1.75e-6, 1.75e-7, 1.4e-5),
        ("gpt-5.3-codex", 1.75e-6, 1.75e-7, 1.4e-5),
        ("gpt-5.4", 2.5e-6, 2.5e-7, 1.5e-5),
        ("gpt-5.4-mini", 7.5e-7, 7.5e-8, 4.5e-6),
        ("gpt-5.4-nano", 2.0e-7, 2.0e-8, 1.25e-6),
        ("gpt-5.5", 5.0e-6, 5.0e-7, 3.0e-5),
        ("gpt-5.5-pro", 3.0e-5, 3.0e-6, 1.8e-4),
        ("gpt-5-mini", 2.5e-7, 2.5e-8, 2.0e-6),
        ("gpt-5-nano", 5.0e-8, 5.0e-9, 4.0e-7),
    ]
    .into_iter()
    .map(|(model, input, cached, output)| {
        (
            model.to_string(),
            LiteLlmModelPricing {
                input_cost_per_token: Some(input),
                cache_read_input_token_cost: Some(cached),
                output_cost_per_token: Some(output),
            },
        )
    })
    .collect()
}

fn alias_for_model(model: &str) -> Option<&'static str> {
    match model {
        "gpt-5-codex" => Some("gpt-5"),
        "gpt-5.3-codex" => Some("gpt-5.2-codex"),
        _ => None,
    }
}

fn is_codex_model(model: &str) -> bool {
    CODEX_MODEL_PREFIXES
        .iter()
        .any(|prefix| model.starts_with(prefix))
}

fn is_openrouter_free_model(model: &str) -> bool {
    let normalized = model.trim().to_lowercase();
    normalized == "openrouter/free"
        || (normalized.starts_with("openrouter/") && normalized.ends_with(":free"))
}

fn to_per_million(value: Option<f64>, fallback: Option<f64>) -> f64 {
    value.or(fallback).unwrap_or(0.0) * MILLION
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_pricing_calculates_gpt_5_5_cost() {
        let source = PricingSource::from_pricing(embedded_pricing());
        let usage = ModelUsage {
            input_tokens: 1_000,
            cached_input_tokens: 200,
            output_tokens: 300,
            reasoning_output_tokens: 0,
            total_tokens: 1_300,
            is_fallback: None,
        };

        let cost = calculate_cost_usd(&usage, source.pricing_for_model("gpt-5.5"));

        assert!((cost - 0.0131).abs() < f64::EPSILON);
    }

    #[test]
    fn unknown_models_are_free() {
        let source = PricingSource::from_pricing(BTreeMap::new());

        assert_eq!(source.pricing_for_model("unknown-model"), Pricing::free());
    }

    #[test]
    fn aliases_fall_back_when_direct_pricing_is_zero() {
        let source = PricingSource::from_pricing(BTreeMap::from([
            (
                "gpt-5.3-codex".to_string(),
                LiteLlmModelPricing {
                    input_cost_per_token: Some(0.0),
                    cache_read_input_token_cost: Some(0.0),
                    output_cost_per_token: Some(0.0),
                },
            ),
            (
                "gpt-5.2-codex".to_string(),
                LiteLlmModelPricing {
                    input_cost_per_token: Some(1.75e-6),
                    cache_read_input_token_cost: Some(1.75e-7),
                    output_cost_per_token: Some(1.4e-5),
                },
            ),
        ]));

        assert_eq!(
            source.pricing_for_model("gpt-5.3-codex"),
            Pricing {
                input_cost_per_m_token: 1.75,
                cached_input_cost_per_m_token: 0.175,
                output_cost_per_m_token: 14.0,
            }
        );
    }

    #[test]
    fn cached_input_price_falls_back_to_input_price() {
        let source = PricingSource::from_pricing(BTreeMap::from([(
            "gpt-5.5".to_string(),
            LiteLlmModelPricing {
                input_cost_per_token: Some(5.0e-6),
                cache_read_input_token_cost: None,
                output_cost_per_token: Some(3.0e-5),
            },
        )]));

        assert_eq!(
            source.pricing_for_model("gpt-5.5"),
            Pricing {
                input_cost_per_m_token: 5.0,
                cached_input_cost_per_m_token: 5.0,
                output_cost_per_m_token: 30.0,
            }
        );
    }

    #[test]
    fn openrouter_free_routes_are_free() {
        let source = PricingSource::from_pricing(embedded_pricing());

        assert_eq!(
            source.pricing_for_model("openrouter/openai/gpt-5.5:free"),
            Pricing::free()
        );
    }
}
