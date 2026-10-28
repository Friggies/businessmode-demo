import { TodoDemo } from "./todo-demo";

export default function Page() {
  return <>
    <header className="site-header">
      <div className="header-inner">
        <a className="brand" href="https://businessmode.io">BusinessMode</a>
        <span className="demo-name">Todo demo</span>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="https://github.com/Friggies/businessmode-demo" target="_blank" rel="noreferrer">View source</a>
        </nav>
      </div>
    </header>
    <main className="page-shell">
      <TodoDemo />
      <section className="integration" id="how-it-works" aria-labelledby="integration-title">
        <h2 id="integration-title">See the integration</h2>
        <ol>
          <li><h3>Identify the visitor</h3><p>Your app supplies an external user ID.</p></li>
          <li><h3>Redeem a code</h3><p>BusinessMode assigns access to that user.</p></li>
          <li><h3>Check access</h3><p>The server checks every task change.</p></li>
        </ol>
      </section>
    </main>
    <footer>Temporary demo data. No email required.</footer>
  </>;
}
