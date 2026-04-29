// Mirror wayang's ambient declarations so cross-package typecheck resolves
// the same modules wayang resolves standalone.
declare module "*.sql" {
  const content: string;
  export default content;
}
