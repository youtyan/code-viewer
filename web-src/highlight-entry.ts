import hljs from "highlight.js";

(globalThis as unknown as { hljs: typeof hljs }).hljs = hljs;
