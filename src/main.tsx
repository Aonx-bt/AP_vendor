import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import { DataProvider } from "./lib/data";
import { TooltipProvider } from "./components/ui/tooltip";
import "./index.css";

// The hosted demo page cannot use URL paths, so it routes in memory.
const Router = import.meta.env.VITE_ARTIFACT ? MemoryRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Router>
      <DataProvider>
        <TooltipProvider>
          <App />
          <Toaster position="bottom-right" richColors closeButton />
        </TooltipProvider>
      </DataProvider>
    </Router>
  </React.StrictMode>,
);
