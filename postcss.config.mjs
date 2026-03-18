import path from "node:path";

if (!process.env.NAPI_RS_NATIVE_LIBRARY_PATH) {
  process.env.NAPI_RS_NATIVE_LIBRARY_PATH = path.resolve(
    "./vendor/tailwindcss-oxide-wasm32-wasi/tailwindcss-oxide.wasi.cjs"
  );
}

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
