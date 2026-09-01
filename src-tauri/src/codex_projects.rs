use crate::types::{
    OverviewProjectRow, ProjectAnalyticsResponse, ProjectReference, SessionDetailRow,
};
use serde::Deserialize;
use std::{collections::HashMap, fs, path::Path};

const GLOBAL_STATE_FILE: &str = ".codex-global-state.json";
const THREAD_ID_LENGTH: usize = 36;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalProject {
    #[serde(default)]
    id: String,
    name: String,
    root_paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadProjectAssignment {
    project_id: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
struct GlobalState {
    #[serde(default)]
    local_projects: HashMap<String, LocalProject>,
    #[serde(default)]
    thread_project_assignments: HashMap<String, ThreadProjectAssignment>,
}

#[derive(Debug, Default)]
pub struct CodexProjectCatalog {
    projects: HashMap<String, LocalProject>,
    assignments: HashMap<String, String>,
}

impl CodexProjectCatalog {
    pub fn load(codex_home: &Path) -> Self {
        fs::read_to_string(codex_home.join(GLOBAL_STATE_FILE))
            .ok()
            .and_then(|contents| serde_json::from_str::<GlobalState>(&contents).ok())
            .map(Self::from_state)
            .unwrap_or_default()
    }

    fn from_state(state: GlobalState) -> Self {
        let projects = state
            .local_projects
            .into_iter()
            .map(|(key, mut project)| {
                if project.id.is_empty() {
                    project.id = key;
                }
                (project.id.clone(), project)
            })
            .collect();
        let assignments = state
            .thread_project_assignments
            .into_iter()
            .map(|(thread_id, assignment)| (thread_id, assignment.project_id))
            .collect();
        Self {
            projects,
            assignments,
        }
    }

    pub fn enrich_overview(&self, overview: &mut crate::types::OverviewResponse) {
        for project in &mut overview.projects {
            self.enrich_project_row(project);
        }
    }

    pub fn enrich_analytics(&self, analytics: &mut ProjectAnalyticsResponse) {
        self.enrich_project_row(&mut analytics.summary);
        analytics.codex_project_id = analytics.summary.codex_project_id.clone();
        analytics.codex_project_name = analytics.summary.codex_project_name.clone();
        analytics.codex_project_root = analytics.summary.codex_project_root.clone();
    }

    pub fn enrich_sessions(&self, sessions: &mut [SessionDetailRow]) {
        for session in sessions {
            let explicit = rollout_thread_id(Path::new(&session.path))
                .and_then(|thread_id| self.assignments.get(thread_id))
                .and_then(|project_id| self.projects.get(project_id));
            session.project_references = session
                .projects
                .iter()
                .map(|path| self.reference_for_path(path, explicit))
                .collect();
        }
    }

    fn enrich_project_row(&self, row: &mut OverviewProjectRow) {
        if let Some((project, root)) = self.match_path(&row.project) {
            row.codex_project_id = Some(project.id.clone());
            row.codex_project_name = Some(project.name.clone());
            row.codex_project_root = Some(root.to_string());
        }
    }

    fn reference_for_path(&self, path: &str, explicit: Option<&LocalProject>) -> ProjectReference {
        let matched = explicit
            .map(|project| (project, longest_matching_root(project, path)))
            .or_else(|| {
                self.match_path(path)
                    .map(|(project, root)| (project, Some(root)))
            });
        let (codex_project_id, codex_project_name, codex_project_root) = matched
            .map(|(project, root)| {
                (
                    Some(project.id.clone()),
                    Some(project.name.clone()),
                    root.map(str::to_string),
                )
            })
            .unwrap_or_default();
        ProjectReference {
            path: path.to_string(),
            display_name: display_name(path),
            codex_project_id,
            codex_project_name,
            codex_project_root,
        }
    }

    fn match_path(&self, path: &str) -> Option<(&LocalProject, &str)> {
        self.projects
            .values()
            .filter_map(|project| longest_matching_root(project, path).map(|root| (project, root)))
            .max_by_key(|(_, root)| root.len())
    }
}

fn longest_matching_root<'a>(project: &'a LocalProject, path: &str) -> Option<&'a str> {
    project
        .root_paths
        .iter()
        .map(String::as_str)
        .filter(|root| path_matches_root(path, root))
        .max_by_key(|root| root.len())
}

fn path_matches_root(path: &str, root: &str) -> bool {
    if path == root {
        return true;
    }
    let Some(suffix) = path.strip_prefix(root) else {
        return false;
    };
    root.ends_with(['/', '\\']) || suffix.starts_with(['/', '\\'])
}

fn display_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
        .to_string()
}

fn rollout_thread_id(path: &Path) -> Option<&str> {
    let stem = path.file_stem()?.to_str()?;
    let id = stem.get(stem.len().checked_sub(THREAD_ID_LENGTH)?..)?;
    let bytes = id.as_bytes();
    bytes
        .iter()
        .enumerate()
        .all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
        .then_some(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog(json: &str) -> CodexProjectCatalog {
        CodexProjectCatalog::from_state(serde_json::from_str(json).unwrap())
    }

    #[test]
    fn matches_exact_and_nested_paths_using_the_longest_root() {
        let catalog = catalog(
            r#"{
            "local-projects": {
                "parent": { "id": "parent", "name": "Parent", "rootPaths": ["/repo"] },
                "camel": { "name": "Camel", "rootPaths": ["/repo/camel", "/repo/camel-services"] }
            }
        }"#,
        );

        let (project, root) = catalog.match_path("/repo/camel/apps/web").unwrap();
        assert_eq!(project.id, "camel");
        assert_eq!(project.name, "Camel");
        assert_eq!(root, "/repo/camel");
        assert_eq!(
            catalog.match_path("/repo/camel-services").unwrap().1,
            "/repo/camel-services"
        );
    }

    #[test]
    fn does_not_match_sibling_prefixes_or_unknown_paths() {
        let catalog = catalog(
            r#"{
            "local-projects": { "camel": { "id": "camel", "name": "Camel", "rootPaths": ["/repo/camel"] } }
        }"#,
        );

        assert!(catalog.match_path("/repo/camelcase").is_none());
        assert!(catalog.match_path("/other/project").is_none());
    }

    #[test]
    fn duplicate_names_keep_distinct_project_ids() {
        let catalog = catalog(
            r#"{
            "local-projects": {
                "one": { "id": "one", "name": "Shared", "rootPaths": ["/repo/one"] },
                "two": { "id": "two", "name": "Shared", "rootPaths": ["/repo/two"] }
            }
        }"#,
        );

        assert_eq!(catalog.match_path("/repo/two").unwrap().0.id, "two");
    }

    #[test]
    fn missing_and_invalid_state_degrade_to_empty_catalog() {
        let temp = std::env::temp_dir().join(format!("codex-projects-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp);
        fs::create_dir_all(&temp).unwrap();
        assert!(CodexProjectCatalog::load(&temp).projects.is_empty());
        fs::write(temp.join(GLOBAL_STATE_FILE), "not json").unwrap();
        assert!(CodexProjectCatalog::load(&temp).projects.is_empty());
        fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn explicit_assignment_takes_priority_when_the_project_exists() {
        let catalog = catalog(
            r#"{
            "local-projects": {
                "selected": { "id": "selected", "name": "Selected", "rootPaths": ["/repo/app"] },
                "other": { "id": "other", "name": "Other", "rootPaths": ["/repo"] }
            },
            "thread-project-assignments": {
                "01977e3d-d9f6-72b7-93cf-f3f2f83c382c": { "projectId": "selected" }
            }
        }"#,
        );
        let explicit = catalog
            .projects
            .get(&catalog.assignments["01977e3d-d9f6-72b7-93cf-f3f2f83c382c"]);

        assert_eq!(
            catalog
                .reference_for_path("/repo/app/web", explicit)
                .codex_project_name
                .as_deref(),
            Some("Selected")
        );
        let outside_root = catalog.reference_for_path("/repo/other", explicit);
        assert_eq!(outside_root.codex_project_name.as_deref(), Some("Selected"));
        assert_eq!(outside_root.codex_project_root, None);
        assert_eq!(
            catalog
                .reference_for_path("/repo/other", None)
                .codex_project_name
                .as_deref(),
            Some("Other")
        );
    }
}
