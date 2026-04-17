// This file is used to replace fetch polyfills that try to overwrite window.fetch
// in protected environments like iframes.

const nativeFetch = typeof window !== 'undefined' ? window.fetch : undefined;

export const fetch = nativeFetch;
export default nativeFetch;

if (typeof window !== 'undefined' && !window.fetch) {
    (window as any).fetch = nativeFetch;
}
