import ts from 'typescript';
import type { NodeCategory } from './schema.ts';

/**
 * §4.1 — a raw AST exposes 300+ `ts.SyntaxKind` values, far more than is useful as a
 * colour encoding. Everything collapses into six coarse buckets.
 *
 * Kept as a standalone module (rather than inline in the generator) so the mapping is
 * unit-testable without running the whole extraction pass.
 */

const DECLARATION_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.Parameter,
  ts.SyntaxKind.TypeParameter,
]);

const CONTROL_FLOW_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.DefaultClause,
  ts.SyntaxKind.TryStatement,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ThrowStatement,
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.BreakStatement,
  ts.SyntaxKind.ContinueStatement,
  ts.SyntaxKind.ConditionalExpression,
]);

const JSX_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.JsxElement,
  ts.SyntaxKind.JsxSelfClosingElement,
  ts.SyntaxKind.JsxFragment,
  ts.SyntaxKind.JsxOpeningElement,
  ts.SyntaxKind.JsxClosingElement,
  ts.SyntaxKind.JsxAttribute,
  ts.SyntaxKind.JsxAttributes,
  ts.SyntaxKind.JsxSpreadAttribute,
  ts.SyntaxKind.JsxExpression,
  ts.SyntaxKind.JsxText,
]);

const IMPORT_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ImportSpecifier,
  ts.SyntaxKind.ImportClause,
  ts.SyntaxKind.NamedImports,
  ts.SyntaxKind.NamespaceImport,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.ExportAssignment,
  ts.SyntaxKind.ExportSpecifier,
  ts.SyntaxKind.NamedExports,
]);

const LITERAL_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateExpression,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.UndefinedKeyword,
  ts.SyntaxKind.ObjectLiteralExpression,
  ts.SyntaxKind.ArrayLiteralExpression,
]);

/**
 * Order matters: JSX is checked before Expression because many JSX kinds are
 * structurally expressions, and the JSX reading is the more useful visual signal.
 */
export function categorize(kind: ts.SyntaxKind): NodeCategory {
  if (JSX_KINDS.has(kind)) return 'JSX';
  if (IMPORT_KINDS.has(kind)) return 'Import';
  if (DECLARATION_KINDS.has(kind)) return 'Declaration';
  if (CONTROL_FLOW_KINDS.has(kind)) return 'ControlFlow';
  if (LITERAL_KINDS.has(kind)) return 'Literal';
  return 'Expression';
}

/** `ts.SyntaxKind[kind]` is a reverse-mapped enum; this narrows it to a stable string. */
export function kindName(kind: ts.SyntaxKind): string {
  return ts.SyntaxKind[kind] ?? `Unknown(${String(kind)})`;
}

/**
 * Pulls a human-readable name out of a node where one exists, so the hover tooltip can
 * read `FunctionDeclaration · renderProjectCard` rather than just the bare kind (§4.6).
 */
export function readLabel(node: ts.Node): string | null {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  if (ts.isJsxFragment(node)) return '<>';

  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }

  const named = node as ts.Node & { name?: ts.Node };
  if (named.name && typeof (named.name as ts.Node).getText === 'function') {
    const text = (named.name as ts.Node).getText();
    return text.length > 0 ? text : null;
  }

  return null;
}
