import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
};

// V8 records generated JavaScript offsets. Persist its source map so c8 can
// attribute those offsets to the actual TypeScript rather than the VM fixture.
export function transpileTestSource(file) {
  const sourcePath = resolve(root, file);
  const source = readFileSync(sourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: sourcePath,
    compilerOptions: {
      ...compilerOptions,
      sourceMap: true,
      inlineSources: true,
    },
    transformers: { before: [(context) => {
      const visit = (node) => {
        // A CommonJS VM has no import.meta; keep the source URL's ESM meaning.
        if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression)
          && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword && node.name.text === "url")
          return ts.factory.createStringLiteral(pathToFileURL(sourcePath).href);
        return ts.visitEachChild(node, visit, context);
      };
      return (node) => ts.visitNode(node, visit);
    }] },
  });
  const map = JSON.parse(compiled.sourceMapText);
  map.sources = [sourcePath];
  map.sourcesContent = [source];
  const code =
    compiled.outputText.replace(/\/\/# sourceMappingURL=.*$/m, "") +
    `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString("base64")}\n`;
  let filename = sourcePath;
  if (process.env.DERSLIK_TEST_COVERAGE === "1") {
    filename = resolve(root, "reports/coverage/generated", `${file}.js`);
    mkdirSync(dirname(filename), { recursive: true });
    writeFileSync(filename, code);
  }
  return { code, filename };
}

export function loadTestModule(
  file,
  { dependencies = {}, globals = {}, suffix = "" } = {},
) {
  const { code, filename } = transpileTestSource(file);
  const exports = {};
  const context = createContext({
    exports,
    module: { exports },
    require: (name) => {
      if (!Object.hasOwn(dependencies, name))
        throw new Error(`Unexpected dependency ${name}`);
      return dependencies[name];
    },
    URL,
    URLSearchParams,
    TextEncoder,
    AbortSignal,
    AbortController,
    process: { env: {} },
    console,
    setTimeout,
    clearTimeout,
    ...globals,
  });
  // eslint-disable-next-line sonarjs/code-eval -- yalnızca depodaki uygulama kaynakları yalıtılmış test bağlamında çalıştırılır
  runInContext(code, context, { filename }); // NOSONAR: yalnızca depodaki uygulama kaynakları yalıtılmış test bağlamında çalıştırılır
  if (suffix) {
    // Fixture-only exports and third-party helper snippets must not count as
    // application lines; compile/run them separately without an application map.
    const fixture = ts.transpileModule(suffix, { compilerOptions }).outputText;
    // eslint-disable-next-line sonarjs/code-eval -- suffix yalnızca depodaki testlerin sağladığı sabit fikstür kodudur
    runInContext(fixture, context, { filename: "derslik-test-fixture" }); // NOSONAR: suffix yalnızca depodaki testlerin sağladığı sabit fikstür kodudur
  }
  return exports;
}
