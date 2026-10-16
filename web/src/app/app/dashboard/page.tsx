'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setSelectedProjectId } from '@/lib/api';

function DashboardRedirector() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const projectId = searchParams.get('project_id') || searchParams.get('project');
    if (projectId && projectId !== 'all' && projectId !== 'global') {
      setSelectedProjectId(projectId);
      router.replace(`/app/projects/${encodeURIComponent(projectId)}`);
    } else {
      router.replace('/app/overview');
    }
  }, [router, searchParams]);

  return (
    <div className="py-20 text-center text-xs text-text-muted">
      Redirecting to service dashboard...
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-xs text-text-muted">Loading dashboard...</div>}>
      <DashboardRedirector />
    </Suspense>
  );
}
