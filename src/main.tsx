import React from "react";
import ReactDOM from "react-dom/client";
import { QoreChainProvider } from "@qorechain/react";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QoreChainProvider config={{ network: "testnet" }}>
      <App />
    </QoreChainProvider>
  </React.StrictMode>
);
