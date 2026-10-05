import assert from "node:assert/strict";

// Source adapter: keeps hooks and actual component handlers across explicit
// renders. DOM/native nodes are descriptors; real layout is checked separately.
export function createTsxFixture() {
  const frames = new Map();
  let current;
  let seen;
  let effects = [];
  const same = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));
  const slot = () => {
    const index = current.index++;
    current.hooks[index] ??= {};
    return current.hooks[index];
  };
  const state = (initial) => {
    const cell = slot();
    if (!Object.hasOwn(cell, "value")) cell.value = typeof initial === "function" ? initial() : initial;
    return [cell.value, (value) => {
      cell.value = typeof value === "function" ? value(cell.value) : value;
    }];
  };
  const memo = (callback, dependencies) => {
    const cell = slot();
    if (!same(cell.dependencies, dependencies)) {
      cell.value = callback();
      cell.dependencies = dependencies;
    }
    return cell.value;
  };
  const react = {
    useState: state,
    useRef(initial) {
      const cell = slot();
      cell.value ??= { current: initial };
      return cell.value;
    },
    useMemo: memo,
    useCallback: (callback, dependencies) => memo(() => callback, dependencies),
    useEffect(callback, dependencies) {
      const cell = slot();
      if (same(cell.dependencies, dependencies)) return;
      cell.dependencies = dependencies;
      effects.push(() => {
        cell.cleanup?.();
        cell.cleanup = callback();
      });
    },
    useReducer(reducer, initial, initialize) {
      const [value, setValue] = state(() => initialize ? initialize(initial) : initial);
      return [value, (action) => setValue((previous) => reducer(previous, action))];
    },
  };
  const element = (type, props, key) => ({ type, props: props ?? {}, key });
  const jsx = { jsx: element, jsxs: element, Fragment: "Fragment" };
  function expand(node, path) {
    if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}/${child?.key ?? index}`));
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") return render(node.type, node.props, `${path}/${node.type.name}`);
    return { ...node, path, props: { ...node.props, children: expand(node.props.children, `${path}/children`) } };
  }
  function render(component, props, path) {
    seen?.add(path);
    const previous = current;
    const frame = frames.get(path) ?? { index: 0, hooks: [] };
    frames.set(path, frame);
    frame.index = 0;
    current = frame;
    const tree = component(props);
    current = previous;
    return expand(tree, `${path}/output`);
  }
  return {
    react,
    jsx,
    render(component, props = {}) {
      seen = new Set();
      const tree = render(component, props, "root");
      for (const [path, frame] of frames) {
        if (seen.has(path)) continue;
        for (const cell of frame.hooks) cell?.cleanup?.();
        frames.delete(path);
      }
      seen = undefined;
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
      return tree;
    },
    unmount() {
      for (const frame of frames.values())
        for (const cell of frame.hooks) cell?.cleanup?.();
      frames.clear();
      effects = [];
    },
  };
}

export function treeNodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(treeNodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...treeNodes(tree.props.children)];
}

export function treeText(tree) {
  if (Array.isArray(tree)) return tree.map(treeText).join("");
  if (!tree || typeof tree === "boolean") return "";
  return typeof tree === "object" ? treeText(tree.props.children) : String(tree);
}

export function oneNode(tree, predicate, message = "one matching view node") {
  const nodes = treeNodes(tree).filter(predicate);
  assert.equal(nodes.length, 1, message);
  return nodes[0];
}
