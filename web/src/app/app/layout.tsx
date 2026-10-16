'use client';

import * as React from 'react';
import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';
import { WorkspaceProvider } from '@/context/WorkspaceContext';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <WorkspaceProvider>
      <div className="min-h-screen bg-canvas text-text-primary flex flex-col font-sans">
        {/* Top Bar with Breadcrumbs & Workspace Switcher */}
        <Header />

        {/* Body Layout: Left Sidebar + Main Content */}
        <div className="flex-1 flex overflow-hidden">
          <Sidebar
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed(!collapsed)}
            serviceName="automation-api"
            environment="production"
          />

          {/* Scrollable Work Area */}
          <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-canvas">
            <div className="max-w-[1240px] mx-auto">
              {children}
            </div>
          </main>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
