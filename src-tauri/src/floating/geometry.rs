use serde::{Deserialize, Serialize};
pub(super) const COMPACT_SIZE: (f64, f64) = (44.0, 44.0);
pub(super) const DETAIL_SIZE: (f64, f64) = (210.0, 275.0);
#[derive(Clone, Copy, Default, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Dock {
    #[default]
    Free,
    Left,
    Right,
    BottomLeft,
    BottomRight,
}
#[derive(Clone, Copy, Debug)]
pub(super) struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}
// A conservative budget, not an assertion about Dock's private magnification bounds.
fn bottom_fits(screen: Rect, length: f64) -> bool {
    screen.w * 0.22 >= length
}
pub(super) fn snap(screen: Rect, window: Rect, bottom: bool, length: f64) -> Dock {
    let cx = window.x + window.w / 2.0;
    if bottom && window.y + window.h >= screen.y + screen.h - 96.0 {
        if cx < screen.x + screen.w * 0.18 {
            return if bottom_fits(screen, length) {
                Dock::BottomLeft
            } else {
                Dock::Left
            };
        }
        if cx > screen.x + screen.w * 0.82 {
            return if bottom_fits(screen, length) {
                Dock::BottomRight
            } else {
                Dock::Right
            };
        }
    }
    if window.x <= screen.x + 22.0 {
        Dock::Left
    } else if window.x + window.w >= screen.x + screen.w - 22.0 {
        Dock::Right
    } else {
        Dock::Free
    }
}
pub(super) fn normalize_dock(screen: Rect, dock: Dock, length: f64) -> Dock {
    match dock {
        Dock::BottomLeft if !bottom_fits(screen, length) => Dock::Left,
        Dock::BottomRight if !bottom_fits(screen, length) => Dock::Right,
        other => other,
    }
}
pub(super) fn place(
    screen: Rect,
    work: Rect,
    anchor: Option<(f64, f64)>,
    dock: Dock,
    expanded: bool,
    length: f64,
) -> Rect {
    let dock = normalize_dock(screen, dock, length);
    let (w, h) = if expanded {
        DETAIL_SIZE
    } else {
        match dock {
            Dock::Left | Dock::Right => COMPACT_SIZE,
            Dock::BottomLeft | Dock::BottomRight => (length, COMPACT_SIZE.1),
            Dock::Free => COMPACT_SIZE,
        }
    };
    let (right, bottom) = anchor.unwrap_or((work.x + work.w - 24.0, work.y + work.h - 24.0));
    let mut x = (right - w).clamp(work.x, (work.x + work.w - w).max(work.x));
    let mut y = (bottom - h).clamp(work.y, (work.y + work.h - h).max(work.y));
    match dock {
        Dock::Left => {
            x = screen.x;
            y = y.min(screen.y + screen.h - h - 48.0);
        }
        Dock::Right => {
            x = screen.x + screen.w - w;
            y = y.min(screen.y + screen.h - h - 48.0);
        }
        Dock::BottomLeft => {
            x = screen.x;
            if !expanded {
                y = screen.y + screen.h - h - 8.0;
            }
        }
        Dock::BottomRight => {
            x = screen.x + screen.w - w;
            if !expanded {
                y = screen.y + screen.h - h - 40.0;
            }
        }
        Dock::Free => {}
    }
    Rect { x, y, w, h }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn screen() -> Rect {
        Rect {
            x: 0.0,
            y: 0.0,
            w: 1440.0,
            h: 900.0,
        }
    }
    #[test]
    fn edge_release_and_bottom_budget() {
        assert_eq!(
            snap(
                screen(),
                Rect {
                    x: 4.0,
                    y: 400.0,
                    w: 84.0,
                    h: 80.0
                },
                true,
                128.0
            ),
            Dock::Left
        );
        assert_eq!(
            snap(
                screen(),
                Rect {
                    x: 1310.0,
                    y: 820.0,
                    w: 84.0,
                    h: 80.0
                },
                true,
                128.0
            ),
            Dock::BottomRight
        );
        assert_eq!(
            snap(
                screen(),
                Rect {
                    x: 650.0,
                    y: 820.0,
                    w: 84.0,
                    h: 80.0
                },
                true,
                128.0
            ),
            Dock::Free
        );
        assert_eq!(
            snap(
                Rect {
                    w: 500.0,
                    ..screen()
                },
                Rect {
                    x: 40.0,
                    y: 820.0,
                    w: 84.0,
                    h: 80.0
                },
                true,
                128.0
            ),
            Dock::Left
        );
        assert_eq!(
            snap(
                screen(),
                Rect {
                    x: 100.0,
                    y: 400.0,
                    w: 84.0,
                    h: 80.0
                },
                true,
                128.0
            ),
            Dock::Free
        );
    }
    #[test]
    fn attached_expansion_stays_inside_display_and_reserves_hot_corner() {
        let work = Rect {
            x: 0.0,
            y: 25.0,
            w: 1440.0,
            h: 800.0,
        };
        let left = place(screen(), work, Some((46.0, 500.0)), Dock::Left, true, 128.0);
        assert_eq!(left.x, 0.0);
        let bottom = place(screen(), work, None, Dock::BottomRight, false, 128.0);
        assert_eq!(bottom.x + bottom.w, 1440.0);
        assert_eq!(bottom.w, 128.0);
        assert_eq!(bottom.y + bottom.h, 860.0);
        let expanded = place(screen(), work, None, Dock::BottomRight, true, 128.0);
        assert!(expanded.y + expanded.h <= 825.0);
    }
}
