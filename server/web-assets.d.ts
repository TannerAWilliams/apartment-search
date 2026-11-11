declare module 'virtual:web-assets' {
  const assets: Record<string, { type: string; binary: boolean; content: string }>;
  export default assets;
}
