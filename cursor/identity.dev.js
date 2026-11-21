// Bundlers resolve the ".js" import in cursor/identity.ts to this file.
// Keep it identical to identity.dev.ts. The published app does not use this viewer.
export const DEV_VIEWER = {
  sub: "user:dev",
  email: "dev@example.com",
  name: "Dev Viewer",
  teamId: 1,
  teamRole: "admin",
};
