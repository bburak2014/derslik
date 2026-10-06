import assert from "node:assert/strict";
import test from "node:test";
import { loadTestModule } from "../scripts/test-source-loader.mjs";
import { createTsxFixture, treeNodes } from "./tsx-fixture.mjs";

// The real Application hooks and handlers run against adapters: Supabase,
// the API and native views are descriptors, not a device test.
function application() {
  const renderer = createTsxFixture();
  const requests = [];
  let authChange;
  const session = (id) => ({
    user: { id, email: `${id}@example.test` },
    access_token: `token-${id}`,
  });
  const { Application } = loadTestModule("apps/mobile/src/App.tsx", {
    dependencies: {
      react: renderer.react,
      "react/jsx-runtime": renderer.jsx,
      "react-native": {
        Alert: { alert() {} },
        ScrollView: "ScrollView",
        Text: "Text",
        View: "View",
      },
      "react-native-safe-area-context": {
        SafeAreaProvider: "SafeAreaProvider",
        SafeAreaView: "SafeAreaView",
      },
      "expo-status-bar": { StatusBar: "StatusBar" },
      "expo-linking": {
        getInitialURL: async () => null,
        addEventListener: () => ({ remove() {} }),
        parse: () => ({}),
      },
      "./core": {
        configured: true,
        watchRefresh: () => () => {},
        request: (path) =>
          new Promise((resolve, reject) =>
            requests.push({ path, resolve, reject }),
          ),
        supabase: {
          auth: {
            getSession: async () => ({ data: { session: session("A") } }),
            onAuthStateChange(callback) {
              authChange = callback;
              return { data: { subscription: { unsubscribe() {} } } };
            },
          },
        },
      },
      "./AuthScreen": { AuthScreen: "AuthScreen" },
      "./oauth": { authRoute: () => null, completeAuthLink: async () => false },
      "./TeacherScreen": { TeacherScreen: "TeacherScreen" },
      "./LearningScreen": { PortalScreen: "PortalScreen" },
      "./DirectoryScreen": { DirectoryScreen: "DirectoryScreen" },
      "@derslik/contracts": { t: (key) => key, noticeAccess: () => null },
      "./i18n": { LanguagePicker: "LanguagePicker", LocaleProvider: "LocaleProvider" },
      "@expo/vector-icons": { Ionicons: "Ionicons" },
      "./ui": {
        useTheme: () => ({ colors: {}, styles: {} }),
        Loading: "Loading",
        ErrorText: "ErrorText",
      },
    },
    suffix: "module.exports.Application = Application;",
  });
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return {
    requests,
    session,
    settle,
    signIn: (id) => authChange(id ? "SIGNED_IN" : "SIGNED_OUT", id ? session(id) : null),
    render: () => renderer.render(Application),
  };
}

const owner = (id) => [{ id: `workspace-${id}`, role: "OWNER", name: id }];
const screens = (tree) =>
  treeNodes(tree).filter((n) => ["Loading", "TeacherScreen", "ErrorText"].includes(n.type));

test("a late access answer of the previous account cannot take over or stall the new session", async () => {
  const app = application();
  app.render();
  await app.settle();
  app.render();
  assert.equal(app.requests.length, 1, "account A asks for its access list");
  // A signs out and B signs in while A's request is still on its way.
  app.signIn(null);
  app.render();
  app.signIn("B");
  app.render();
  assert.equal(app.requests.length, 2);
  app.requests[1].resolve({ data: owner("B") });
  await app.settle();
  app.render();
  app.requests[0].resolve({ data: owner("A") });
  await app.settle();
  const tree = app.render();
  const shown = screens(tree);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].type, "TeacherScreen");
  assert.equal(shown[0].props.access.id, "workspace-B");
});

test("a failed access request of the current account shows the error instead of loading forever", async () => {
  const app = application();
  app.render();
  await app.settle();
  app.render();
  app.requests[0].reject(new Error("offline"));
  await app.settle();
  const tree = app.render();
  assert.ok(!treeNodes(tree).some((n) => n.type === "Loading"));
});
