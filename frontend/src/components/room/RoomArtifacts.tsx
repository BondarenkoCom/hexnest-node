import { Package, Terminal, ChevronRight } from 'lucide-react';
import type { Artifact } from '../../types';

interface RoomArtifactsProps {
  artifacts: Artifact[];
  pythonJobs: any[];
}

export const RoomArtifacts: React.FC<RoomArtifactsProps> = ({ artifacts, pythonJobs }) => {
  return (
    <div className="space-y-4">
      {/* Artifacts Section */}
      <div className="bg-void border border-line-soft rounded-2xl overflow-hidden shadow-lg">
        <div className="p-4 bg-void-dark flex items-center gap-2 border-b border-line-soft">
          <Package className="w-4 h-4 text-emerald-400" />
          <h3 className="text-xs uppercase font-bold tracking-widest text-text">Knowledge Artifacts</h3>
          <span className="ml-auto text-[10px] font-mono text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">
            {artifacts.length}
          </span>
        </div>
        <div className="p-4 space-y-3">
          {artifacts.length === 0 ? (
            <p className="text-[10px] text-muted text-center py-6 italic opacity-50">No artifacts synthesized in this session.</p>
          ) : (
            artifacts.map((art) => (
              <details key={art.id} className="group border border-line-soft/30 rounded-xl overflow-hidden bg-void-dark/20 text-text">
                <summary className="p-3 flex items-center gap-3 cursor-pointer hover:bg-void-dark/40 transition-colors list-none">
                  <ChevronRight className="w-4 h-4 text-muted group-open:rotate-90 transition-transform" />
                  <div className="flex-1">
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="text-sm font-bold text-text-muted group-open:text-cyan-soft transition-colors">{art.label}</span>
                      <span className="text-[9px] font-mono text-muted uppercase">{art.type}</span>
                    </div>
                    <span className="text-[10px] text-muted/60 font-mono">Produced by {art.producer}</span>
                  </div>
                </summary>
                <div className="p-4 bg-void-dark/60 border-t border-line-soft/30">
                  <pre className="text-xs font-mono text-text-muted leading-relaxed whitespace-pre-wrap selection:bg-cyan/30">
                    {art.content}
                  </pre>
                </div>
              </details>
            ))
          )}
        </div>
      </div>

      {/* Python Jobs Section */}
      <div className="bg-void border border-line-soft rounded-2xl overflow-hidden shadow-lg">
        <div className="p-4 bg-void-dark flex items-center gap-2 border-b border-line-soft">
          <Terminal className="w-4 h-4 text-cyan" />
          <h3 className="text-xs uppercase font-bold tracking-widest text-text">Runtime Computations</h3>
          <span className="ml-auto text-[10px] font-mono text-cyan bg-cyan/10 px-1.5 py-0.5 rounded">
            {pythonJobs.length}
          </span>
        </div>
        <div className="p-4 space-y-3">
          {pythonJobs.length === 0 ? (
            <p className="text-[10px] text-muted text-center py-6 italic opacity-50">No python execution logs recorded.</p>
          ) : (
            pythonJobs.map((job) => (
              <div key={job.id} className="border border-line-soft/30 rounded-xl overflow-hidden bg-void-dark/20 p-3 space-y-2">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-cyan/10 rounded-lg">
                      <Terminal className="w-3 h-3 text-cyan" />
                    </div>
                    <div>
                      <span className="text-[11px] font-bold text-text-muted">{job.agentName}</span>
                      <p className="text-[9px] text-muted font-mono uppercase tracking-tighter">Job {job.status}</p>
                    </div>
                  </div>
                  <span className="text-[9px] text-muted font-mono">{new Date(job.createdAt).toLocaleTimeString()}</span>
                </div>
                <div className="p-3 bg-black/40 rounded-lg border border-line-soft/20 overflow-x-auto custom-scrollbar">
                  <code className="text-[10px] font-mono text-emerald-400 selection:bg-emerald-500/30">
                    {job.stdout || job.error || 'Execution completed with no output.'}
                  </code>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
