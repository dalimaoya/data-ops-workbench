import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Progress, Typography } from 'antd';
import axios from 'axios';

const { Title, Text } = Typography;

interface StartupProgress {
  stage: string;
  stage_label: string;
  percent: number;
  ready: boolean;
}

export default function Loading() {
  const [progress, setProgress] = useState<StartupProgress>({
    stage: 'initializing_db',
    stage_label: '正在初始化数据库...',
    percent: 0,
    ready: false,
  });
  const navigate = useNavigate();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await axios.get<StartupProgress>('/api/startup-progress', {
          timeout: 2000,
        });
        setProgress(res.data);
        if (res.data.ready) {
          // Ready — wait 500ms then redirect to login
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          setTimeout(() => {
            navigate('/login', { replace: true });
          }, 500);
        }
      } catch {
        // Server not yet accepting connections — keep polling
      }
    };

    // Poll immediately
    poll();
    timerRef.current = setInterval(poll, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [navigate]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}
    >
      <div
        style={{
          textAlign: 'center',
          padding: '48px 64px',
          background: 'rgba(255,255,255,0.95)',
          borderRadius: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
          minWidth: 380,
        }}
      >
        <img
          src="/logo.png"
          alt="DataOps Workbench"
          style={{ height: 80, marginBottom: 16 }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
        <Title level={3} style={{ marginTop: 0, marginBottom: 32, color: '#333' }}>
          数据运维工作台
        </Title>

        <Progress
          percent={progress.percent}
          status={progress.ready ? 'success' : 'active'}
          strokeColor={{
            '0%': '#667eea',
            '100%': '#764ba2',
          }}
          style={{ marginBottom: 16 }}
        />

        <Text style={{ fontSize: 14, color: '#666' }}>
          {progress.stage_label}
        </Text>
      </div>
    </div>
  );
}
