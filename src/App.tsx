import { getCurrentWindow } from "@tauri-apps/api/window";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DashboardPage } from "./dashboard/DashboardPage";
import { OverlayPage } from "./overlay/OverlayPage";
import { SettingsPage } from "./settings/SettingsPage";

// Determine which window we are at module load time (synchronous)
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
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
