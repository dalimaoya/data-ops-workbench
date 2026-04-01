import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { DatasourceOnlineProvider } from './context/DatasourceOnlineContext';
import App from './App';
import './i18n';
import './index.css';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <DatasourceOnlineProvider>
          <App />
        </DatasourceOnlineProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
