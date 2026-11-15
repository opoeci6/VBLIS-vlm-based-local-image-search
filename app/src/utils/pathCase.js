// Windows paths ignore case; a Linux server's don't. The session info sets this in a browser.
let caseSensitive = false;
export const setCaseSensitivePaths = (value) => { caseSensitive = Boolean(value); };
export const foldPath = (path) => (caseSensitive ? path : path.toLowerCase());
