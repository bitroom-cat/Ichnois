"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
  Suspense,
} from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import {
  api,
  Project,
  WorkspaceMetrics,
  getSelectedProjectId,
  setSelectedProjectId,
} from '@/lib/api';

export interface WorkspaceContextType {
  currentWorkspace: 'global' | string;
  isGlobal: boolean;
  activeProject: Project | null;
  projects: Project[];
  metrics: WorkspaceMetrics | null;
  loading: boolean;
  error: string | null;
  refreshMetrics: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  selectWorkspace: (workspace: 'global' | string) => void;
}

const defaultWorkspaceContext: WorkspaceContextType = {
  currentWorkspace: 'global',
  isGlobal: true,
  activeProject: null,
  projects: [],
  metrics: null,
  loading: false,
  error: null,
  refreshMetrics: async () => {},
  refreshProjects: async () => {},
  selectWorkspace: () => {},
};

const WorkspaceContext = createContext<WorkspaceContextType>(defaultWorkspaceContext);

function SearchParamsSync({ onSync }: { onSync: (projectParam: string | null) => void }) {
  const searchParams = useSearchParams();
  const projectParam = searchParams.get('project');

  useEffect(() => {
    onSync(projectParam);
  }, [projectParam, onSync]);

  return null;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [currentWorkspace, setCurrentWorkspace] = useState<'global' | string>(() => {
    if (typeof window === 'undefined') return 'global';
    const saved = getSelectedProjectId();
    return saved === 'all' ? 'global' : saved;
  });

  const [projects, setProjects] = useState<Project[]>([]);
  const [metrics, setMetrics] = useState<WorkspaceMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const isGlobal = currentWorkspace === 'global' || currentWorkspace === 'all';

  const activeProject = useMemo(() => {
    if (isGlobal) return null;
    return projects.find((p) => p.project_id === currentWorkspace) || null;
  }, [isGlobal, projects, currentWorkspace]);

  const refreshProjects = useCallback(async () => {
    try {
      const data = await api.getProjects();
      setProjects(data);
    } catch (err: any) {
      console.error('Failed to load projects:', err);
      setError(err?.message || 'Failed to load projects');
    }
  }, []);

  const refreshMetrics = useCallback(async () => {
    try {
      const data = await api.getWorkspaceMetrics(isGlobal ? undefined : currentWorkspace);
      setMetrics(data);
    } catch (err: any) {
      console.error('Failed to load workspace metrics:', err);
    }
  }, [isGlobal, currentWorkspace]);

  // Initial load
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      setLoading(true);
      await refreshProjects();
      if (mounted) setLoading(false);
    };
    init();
    return () => {
      mounted = false;
    };
  }, [refreshProjects]);

  // Load metrics when workspace or projects change
  useEffect(() => {
    refreshMetrics();
  }, [refreshMetrics]);

  const handleSyncParam = useCallback((projectParam: string | null) => {
    if (projectParam) {
      const normalized = projectParam === 'all' || projectParam === 'global' ? 'global' : projectParam;
      setCurrentWorkspace((prev) => {
        if (prev !== normalized) {
          setSelectedProjectId(normalized === 'global' ? 'all' : normalized);
          return normalized;
        }
        return prev;
      });
    }
  }, []);

  // Listen to external custom events
  useEffect(() => {
    const handleProjectChanged = (e: any) => {
      const id = e?.detail?.projectId || getSelectedProjectId();
      const normalized = id === 'all' || id === 'global' ? 'global' : id;
      setCurrentWorkspace(normalized);
    };

    window.addEventListener('project_changed', handleProjectChanged);
    return () => window.removeEventListener('project_changed', handleProjectChanged);
  }, []);

  const selectWorkspace = useCallback(
    (workspace: 'global' | string) => {
      const normalized = workspace === 'all' || workspace === 'global' ? 'global' : workspace;
      setCurrentWorkspace(normalized);
      setSelectedProjectId(normalized === 'global' ? 'all' : normalized);

      // Update URL query param
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        if (normalized === 'global') {
          params.delete('project');
        } else {
          params.set('project', normalized);
        }
        const newSearch = params.toString();
        const newUrl = `${pathname}${newSearch ? `?${newSearch}` : ''}`;
        router.replace(newUrl, { scroll: false });
      }
    },
    [pathname, router]
  );

  const value = useMemo<WorkspaceContextType>(
    () => ({
      currentWorkspace,
      isGlobal,
      activeProject,
      projects,
      metrics,
      loading,
      error,
      refreshMetrics,
      refreshProjects,
      selectWorkspace,
    }),
    [
      currentWorkspace,
      isGlobal,
      activeProject,
      projects,
      metrics,
      loading,
      error,
      refreshMetrics,
      refreshProjects,
      selectWorkspace,
    ]
  );

  return (
    <WorkspaceContext.Provider value={value}>
      <Suspense fallback={null}>
        <SearchParamsSync onSync={handleSyncParam} />
      </Suspense>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextType {
  const context = useContext(WorkspaceContext);
  return context || defaultWorkspaceContext;
}
