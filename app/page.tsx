import { TodoDemo } from "./todo-demo";

export default function Page() {
  return <>
    <header className="site-header"><div className="header-inner">
      <a className="brand" href="https://businessmode.io">BusinessMode</a>
      <a className="source-link" href="https://github.com/Friggies/businessmode-demo" target="_blank" rel="noreferrer">View source ↗</a>
    </div></header>
    <main className="page-shell">
      <div className="page-intro"><p className="eyebrow">Interactive demo</p><h1>One code. Access granted.</h1><p>Unlock a simple to-do list with a real BusinessMode access code.</p></div>
      <TodoDemo />
      <details className="integration" id="how-it-works">
        <summary>For developers: how it works</summary>
        <p>Next.js creates a guest session, then the BusinessMode SDK redeems the code and checks <code>todo:write</code> before each edit. Tasks stay in your browser; access records live in BusinessMode staging.</p>
        <p>In your app, use your existing login and check access before changing protected data on the server. <a href="https://github.com/Friggies/businessmode-demo#readme" target="_blank" rel="noreferrer">Read the integration guide ↗</a></p>
      </details>
    </main>
    <footer>No signup. No shared task data. Reset whenever you like.</footer>
  </>;
}
