import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { NodeProvider, useNode } from './context/NodeContext';
import { Layout } from './components/Layout';
import AyaLoader from './components/AyaLoader';
import { StatusPage } from './pages/StatusPage';
import { AgentsPage } from './pages/AgentsPage';
import { LogsPage } from './pages/LogsPage';
import { NewRoomPage } from './pages/NewRoomPage';
import { RoomDetailView } from './pages/RoomDetailView';
import { AuthPage } from './pages/AuthPage';

const AppRoutes: React.FC = () => {
  const { loading, isAuthenticated } = useNode();

  if (loading || isAuthenticated === null) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-void">
        <AyaLoader 
          title="INITIALISING NODE PROTOCOL"
          subtitle="Wait for secure connection with the swarm..."
          variant="panel"
        />
      </div>
    );
  }

  return (
    <>
      <Layout>
        <Routes>
          <Route path="/" element={<StatusPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/new-room" element={<NewRoomPage />} />
          <Route path="/rooms/:roomId" element={<RoomDetailView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      <AuthPage open={!isAuthenticated} />
    </>
  );
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <NodeProvider>
        <AppRoutes />
      </NodeProvider>
    </BrowserRouter>
  );
};

export default App;
