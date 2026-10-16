'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useWorkspace } from '@/context/WorkspaceContext';
import { api, RunItem } from '@/lib/api';
import {
  Globe,
  Activity,
  Layers,
  FolderKanban,
  Flame,
  Settings,
  Radio,
  ChevronRight,
} from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: React.ReactNode;
  isActive: boolean;
  isMono?: boolean;
  isIncident?: boolean;
  title?: string;
}

function BreadcrumbNavInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { currentWorkspace, isGlobal, activeProject, projects } = useWorkspace();

  const [incidentProjectMap, setIncidentProjectMap] = useState<Record<string, string>>({});

  // Parse path segments
  const pathParts = useMemo(() => pathname.split('/').filter(Boolean), [pathname]);

  // Extract route parameters
  const isRunsList = pathname === '/app/runs';
  const isRunDetail = pathname.startsWith('/app/runs/') && pathParts.length >= 3;
  const runId = isRunDetail ? pathParts[2] : null;

  const isProjectsList = pathname === '/app/projects';
  const isProjectDetail = pathname.startsWith('/app/projects/') && pathParts.length >= 3;
  const projectParamId = isProjectDetail ? pathParts[2] : null;

  const isSettings = pathname === '/app/settings';
  const isConnections = pathname === '/app/connections';
  const isOverview = pathname === '/app/overview' || pathname === '/app';

  // Check query parameter project override
  const queryProjectId = searchParams.get('project');
  const activeScopedProjectId =
    queryProjectId && queryProjectId !== 'all' && queryProjectId !== 'global'
      ? queryProjectId
      : !isGlobal
      ? currentWorkspace
      : null;

  // If viewing a single incident, ensure we resolve its parent project_id
  useEffect(() => {
    let isMounted = true;
    if (runId && !incidentProjectMap[runId]) {
      api
        .getRunById(runId)
        .then((run: RunItem | null) => {
          if (!isMounted) return;
          if (run?.project_id) {
            setIncidentProjectMap((prev) => ({
              ...prev,
              [runId]: run.project_id!,
            }));
          }
        })
        .catch(() => {
          // If fetch fails, we gracefully fall back to context/query
        });
    }
    return () => {
      isMounted = false;
    };
  }, [runId, incidentProjectMap]);

  // Helper to find project name from ID
  const getProjectName = (pId: string): string => {
    const found = projects.find((p) => p.project_id === pId);
    if (found?.name) return found.name;
    // Formatting fallback (e.g. "checkout-service" -> "Checkout Service")
    return pId
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  // Build the breadcrumb path according to strict specification
  const items: BreadcrumbItem[] = useMemo(() => {
    // ----------------------------------------------------
    // 1. Single Incident Details (/app/runs/{incident_id})
    // ----------------------------------------------------
    if (isRunDetail && runId) {
      // Determine if this incident belongs to a microservice/project
      const projectForRun =
        incidentProjectMap[runId] ||
        activeScopedProjectId ||
        (!isGlobal && currentWorkspace !== 'global' ? currentWorkspace : null);

      if (projectForRun && projectForRun !== 'global' && projectForRun !== 'all') {
        // Microservices / Projects Section:
        // {project_name} / {project_id} / {incident_id}
        const projectName = getProjectName(projectForRun);
        return [
          {
            label: projectName,
            href: `/app/projects/${projectForRun}`,
            icon: <FolderKanban className="w-3.5 h-3.5 text-purple-500" />,
            isActive: false,
            title: `Project: ${projectName}`,
          },
          {
            label: projectForRun,
            href: `/app/runs?project=${projectForRun}`,
            icon: <Layers className="w-3.5 h-3.5 text-text-muted" />,
            isActive: false,
            isMono: true,
            title: `Microservice ID: ${projectForRun}`,
          },
          {
            label: runId,
            href: `/app/runs/${runId}`,
            icon: <Flame className="w-3.5 h-3.5 text-amber-500" />,
            isActive: true,
            isMono: true,
            isIncident: true,
            title: `Incident Run: ${runId}`,
          },
        ];
      }

      // Fleet Section:
      // Fleet / Incidents / {incident_id}
      return [
        {
          label: 'Fleet',
          href: '/app/overview',
          icon: <Globe className="w-3.5 h-3.5 text-indigo-500" />,
          isActive: false,
          title: 'Fleet Overview',
        },
        {
          label: 'Incidents',
          href: '/app/runs',
          icon: <Activity className="w-3.5 h-3.5 text-purple-500" />,
          isActive: false,
          title: 'Fleet Incidents',
        },
        {
          label: runId,
          href: `/app/runs/${runId}`,
          icon: <Flame className="w-3.5 h-3.5 text-amber-500" />,
          isActive: true,
          isMono: true,
          isIncident: true,
          title: `Incident Run: ${runId}`,
        },
      ];
    }

    // ----------------------------------------------------
    // 2. Incidents List (/app/runs)
    // ----------------------------------------------------
    if (isRunsList) {
      if (activeScopedProjectId && activeScopedProjectId !== 'global' && activeScopedProjectId !== 'all') {
        // Scoped project incidents view:
        // {project_name} / {project_id}
        const projectName = getProjectName(activeScopedProjectId);
        return [
          {
            label: projectName,
            href: `/app/projects/${activeScopedProjectId}`,
            icon: <FolderKanban className="w-3.5 h-3.5 text-purple-500" />,
            isActive: false,
            title: `Project: ${projectName}`,
          },
          {
            label: activeScopedProjectId,
            href: `/app/runs?project=${activeScopedProjectId}`,
            icon: <Activity className="w-3.5 h-3.5 text-purple-500" />,
            isActive: true,
            isMono: true,
            title: `Project Incidents: ${activeScopedProjectId}`,
          },
        ];
      }

      // Fleet Incidents List:
      // Fleet / Incidents
      return [
        {
          label: 'Fleet',
          href: '/app/overview',
          icon: <Globe className="w-3.5 h-3.5 text-indigo-500" />,
          isActive: false,
          title: 'Fleet Overview',
        },
        {
          label: 'Incidents',
          href: '/app/runs',
          icon: <Activity className="w-3.5 h-3.5 text-purple-500" />,
          isActive: true,
          title: 'Fleet Incidents List',
        },
      ];
    }

    // ----------------------------------------------------
    // 3. Single Project View (/app/projects/{project_id})
    // ----------------------------------------------------
    if (isProjectDetail && projectParamId) {
      const projectName = getProjectName(projectParamId);
      // Single Project View:
      // {project_name}
      return [
        {
          label: projectName,
          href: `/app/projects/${projectParamId}`,
          icon: <FolderKanban className="w-3.5 h-3.5 text-purple-500" />,
          isActive: true,
          title: `Project Hub: ${projectName}`,
        },
      ];
    }

    // ----------------------------------------------------
    // 4. All Microservices (/app/projects)
    // ----------------------------------------------------
    if (isProjectsList) {
      // All Microservices (Projects List view):
      // Microservices
      return [
        {
          label: 'Microservices',
          href: '/app/projects',
          icon: <Layers className="w-3.5 h-3.5 text-purple-500" />,
          isActive: true,
          title: 'All Microservices Fleet',
        },
      ];
    }

    // ----------------------------------------------------
    // 5. Fleet Overview (/app/overview)
    // ----------------------------------------------------
    if (isOverview) {
      // Fleet Overview:
      // Fleet
      return [
        {
          label: 'Fleet',
          href: '/app/overview',
          icon: <Globe className="w-3.5 h-3.5 text-indigo-500" />,
          isActive: true,
          title: 'Fleet Operations Overview',
        },
      ];
    }

    // ----------------------------------------------------
    // 6. Settings (/app/settings)
    // ----------------------------------------------------
    if (isSettings) {
      if (!isGlobal && activeProject) {
        return [
          {
            label: activeProject.name,
            href: `/app/projects/${activeProject.project_id}`,
            icon: <FolderKanban className="w-3.5 h-3.5 text-purple-500" />,
            isActive: false,
          },
          {
            label: 'Settings',
            href: `/app/settings?project=${activeProject.project_id}`,
            icon: <Settings className="w-3.5 h-3.5 text-text-muted" />,
            isActive: true,
          },
        ];
      }
      return [
        {
          label: 'Fleet',
          href: '/app/overview',
          icon: <Globe className="w-3.5 h-3.5 text-indigo-500" />,
          isActive: false,
        },
        {
          label: 'Settings',
          href: '/app/settings',
          icon: <Settings className="w-3.5 h-3.5 text-text-muted" />,
          isActive: true,
        },
      ];
    }

    // ----------------------------------------------------
    // 7. Connections (/app/connections)
    // ----------------------------------------------------
    if (isConnections) {
      if (!isGlobal && activeProject) {
        return [
          {
            label: activeProject.name,
            href: `/app/projects/${activeProject.project_id}`,
            icon: <FolderKanban className="w-3.5 h-3.5 text-purple-500" />,
            isActive: false,
          },
          {
            label: 'Connections',
            href: '/app/connections',
            icon: <Radio className="w-3.5 h-3.5 text-text-muted" />,
            isActive: true,
          },
        ];
      }
      return [
        {
          label: 'Fleet',
          href: '/app/overview',
          icon: <Globe className="w-3.5 h-3.5 text-indigo-500" />,
          isActive: false,
        },
        {
          label: 'Connections',
          href: '/app/connections',
          icon: <Radio className="w-3.5 h-3.5 text-text-muted" />,
          isActive: true,
        },
      ];
    }

    // Default fallback
    return [
      {
        label: isGlobal ? 'Fleet' : activeProject?.name || 'Workspace',
        href: '/app/overview',
        icon: <Globe className="w-3.5 h-3.5 text-indigo-500" />,
        isActive: true,
      },
    ];
  }, [
    pathname,
    runId,
    projectParamId,
    isRunDetail,
    isRunsList,
    isProjectDetail,
    isProjectsList,
    isOverview,
    isSettings,
    isConnections,
    activeScopedProjectId,
    isGlobal,
    currentWorkspace,
    activeProject,
    incidentProjectMap,
    projects,
  ]);

  return (
    <nav
      aria-label="Breadcrumb Navigation"
      className="flex items-center gap-1 sm:gap-1.5 text-xs text-text-secondary min-w-0 overflow-x-auto no-scrollbar py-0.5 select-none"
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <React.Fragment key={`${item.label}-${index}`}>
            {index > 0 && (
              <span
                className="text-text-muted/40 font-mono text-xs select-none shrink-0 px-0.5"
                aria-hidden="true"
              >
                /
              </span>
            )}

            {isLast || !item.href ? (
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md transition-all truncate ${
                  item.isIncident
                    ? 'font-mono text-purple-600 dark:text-purple-400 font-semibold bg-purple-500/10 border border-purple-500/20 max-w-[150px] sm:max-w-[200px]'
                    : item.isMono
                    ? 'font-mono font-medium text-text-primary bg-surface-sunken/60 border border-border-subtle max-w-[130px] sm:max-w-[170px]'
                    : 'font-semibold text-text-primary max-w-[150px] sm:max-w-[220px]'
                }`}
                title={item.title || item.label}
                aria-current="page"
              >
                {item.icon && <span className="shrink-0">{item.icon}</span>}
                <span className="truncate">{item.label}</span>
              </span>
            ) : (
              <Link
                href={item.href}
                className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-hover/80 transition-all truncate ${
                  item.isMono
                    ? 'font-mono max-w-[120px] sm:max-w-[150px]'
                    : 'font-medium max-w-[140px] sm:max-w-[180px]'
                }`}
                title={item.title || item.label}
              >
                {item.icon && <span className="shrink-0">{item.icon}</span>}
                <span className="truncate">{item.label}</span>
              </Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

export function BreadcrumbNav() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-1.5 text-xs text-text-muted font-medium animate-pulse">
          <Globe className="w-3.5 h-3.5 text-indigo-500" />
          <span>Fleet</span>
        </div>
      }
    >
      <BreadcrumbNavInner />
    </Suspense>
  );
}
