import { Routes, Route, Navigate } from "react-router-dom";
import Home from "./pages/Home";
import LiveTvPage from "./pages/LiveTvPage";
import ChannelsPage from "./pages/ChannelsPage";
import ProfilePage from "./pages/ProfilePage";
import LanguagesPage from "./pages/LanguagesPage";
import PlayerPage from "./pages/PlayerPage";
import FeedbackPage from "./pages/FeedbackPage";
import AppInfoPage from "./pages/AppInfoPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="/home" element={<Home />} />
      <Route path="/live-tv" element={<LiveTvPage />} />
      <Route path="/channels" element={<ChannelsPage />} />
      <Route path="/languages" element={<LanguagesPage />} />
      <Route path="/player" element={<PlayerPage />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/feedback" element={<FeedbackPage />} />
      <Route path="/app-info" element={<AppInfoPage />} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
