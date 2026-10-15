'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { api, Project, getSelectedProjectId, setSelectedProjectId } from '@/lib/api';
import { ChevronDown, Check, Plus, FolderKanban, Globe, Shield, Sparkles } from 'lucide-react';

export function ProjectSwitcher() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string>('all');
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadProjects = async () => {
    try {
      const data = await api.getProjects();
      setProjects(data);
    } catch {
      // Fallback
    }
  };

  useEffect(() => {
    setSelectedId(getSelectedProjectId());
    loadProjects();

    const onProjectChanged = (e: any) => {
      setSelectedId(getSelectedProjectId());
    };

    window.addEventListener('project_changed', onProjectChanged);
    return () => window.removeEventListener('project_changed', onProjectChanged);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const activeProject = projects.find((p) => p.project_id === selectedId);

  const handleSelect = (id: string) => {
    setSelectedProjectId(id);
    setSelectedId(id);
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-hover border border-border-subtle bg-surface-raised/40 text-text-primary text-xs font-medium transition-colors select-none group"
      >
        <span className="w-4 h-4 rounded bg-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center text-[10px] font-bold shrink-0">
          <FolderKanban className="w-3 h-3" />
        </span>
        <span className="truncate max-w-[130px] font-semibold">
          {selectedId === 'all' ? 'All Projects' : activeProject?.name || selectedId}
        </span>
        {activeProject && (
          <span className="hidden sm:inline-block px-1.5 py-0.2 text-[9px] rounded uppercase tracking-wider bg-surface-sunken text-text-muted border border-border-subtle">
            {activeProject.environment}
          </span>
        )}
        <ChevronDown className="w-3 h-3 text-text-muted group-hover:text-text-primary transition-colors" />
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-1.5 w-64 origin-top-left rounded-lg bg-surface border border-border-strong shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
          <div className="px-3 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider border-b border-border-subtle flex items-center justify-between">
            <span>Select Active Project</span>
            <span className="text-[9px] font-normal">{projects.length} Available</span>
          </div>

          <div className="max-h-60 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => handleSelect('all')}
              className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-hover ${
                selectedId === 'all' ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 font-medium' : 'text-text-primary'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>All Projects (Aggregate)</span>
              </div>
              {selectedId === 'all' && <Check className="w-3.5 h-3.5" />}
            </button>

            {projects.map((proj) => {
              const isSelected = selectedId === proj.project_id;
              return (
                <button
                  key={proj.project_id}
                  type="button"
                  onClick={() => handleSelect(proj.project_id)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-hover ${
                    isSelected ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 font-medium' : 'text-text-primary'
                  }`}
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="truncate font-medium">{proj.name}</span>
                    <span className="text-[10px] text-text-muted truncate">
                      {proj.project_id} • {proj.environment}
                    </span>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>

          <div className="border-t border-border-subtle pt-1 mt-1 px-1">
            <Link
              href="/app/projects"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-hover rounded transition-colors"
            >
              <Plus className="w-3 h-3 text-purple-500" />
              <span>Manage & Create Projects</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
