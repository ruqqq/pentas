// Mirror papan's ambient declarations so cross-package typecheck resolves
// the same modules papan resolves standalone.
declare module "*.sql" {
  const content: string;
  export default content;
}

declare module "*.css" {
  const path: string;
  export default path;
}

declare module "*.js" {
  const path: string;
  export default path;
}
