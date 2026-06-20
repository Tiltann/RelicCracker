import { getCurrentWindow } from "@tauri-apps/api/window";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DashboardPage } from "./dashboard/DashboardPage";
import { LogsPage } from "./logs/LogsPage";
import { CompletionsPage } from "./completions/CompletionsPage";
import { OverlayPage } from "./overlay/OverlayPage";
import { SettingsPage } from "./settings/SettingsPage";

const windowLabel = getCurrentWindow().label;

export default function App() {
  if (windowLabel === "overlay") {
    return <OverlayPage />;
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="completions" element={<CompletionsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
