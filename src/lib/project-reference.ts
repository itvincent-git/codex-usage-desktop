import type { ProjectReference, SessionDetailRow } from "@/lib/api";

export function sessionProjectReferences(session: SessionDetailRow): ProjectReference[] {
  if (session.projectReferences?.length) return session.projectReferences;
  return session.projects.map((path) => ({
    path,
    displayName: path.split(/[\\/]/).filter(Boolean).pop() || path,
  }));
}

export function projectLabel(project: Pick<ProjectReference, "displayName" | "codexProjectName">) {
  return project.codexProjectName || project.displayName;
}
