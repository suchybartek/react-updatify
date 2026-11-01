import React, { useState } from 'react';

// Change VERSION, run `npm run build`, and watch an already open tab:
// it shows the "Updating" screen and reloads itself into the new version.
const VERSION = 1;

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main style={{ fontFamily: 'system-ui', padding: 32 }}>
      <h1>Example shop — version {VERSION}</h1>
      <p>
        Nothing in this React code knows about react-updatify: the Vite plugin injects the update screen.
      </p>
      <button onClick={() => setCount(count + 1)}>Clicked {count} times</button>
      <p>
        Preview the update screen: <a href="?updatify-preview">?updatify-preview</a> ·{' '}
        <a href="?updatify-preview=indeterminate">indeterminate</a> · <a href="?updatify-preview=banner">banner</a>
      </p>
    </main>
  );
}
