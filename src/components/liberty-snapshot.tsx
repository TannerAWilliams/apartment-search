/** The native app draws card thumbnails from street tiles; Liberty pictures are drawn in the browser only. */
export function warmSnapshots() {}
export function libertySnapshot(_latitude: number, _longitude: number, _width: number, _height: number): Promise<string> {
  return Promise.reject(new Error('Liberty pictures are drawn in the browser only.'));
}
