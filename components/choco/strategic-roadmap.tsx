"use client";

import { motion } from "framer-motion";
import { MoveRight, Target, LayoutDashboard, Database } from "lucide-react";

interface Priority {
  id: number;
  title: string;
  kpi: string;
  steps: string[];
}

interface StrategicRoadmapProps {
  data: Priority[];
}

export function StrategicRoadmap({ data }: StrategicRoadmapProps) {
  const icons = [<Target className="text-[#E50000]" />, <LayoutDashboard className="text-blue-500" />, <Database className="text-purple-500" />];

  return (
    <div className="grid grid-cols-1 gap-6">
      {data.map((priority, idx) => (
        <motion.div
          key={priority.id}
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          transition={{ delay: idx * 0.1 }}
          viewport={{ once: true }}
          className="relative p-8 rounded-3xl border border-white/10 bg-[#111111]/80 backdrop-blur-xl group hover:bg-white/[0.02] transition-all shadow-2xl overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-12 opacity-5 scale-150 rotate-12 group-hover:rotate-0 transition-transform duration-500">
            {icons[idx % icons.length]}
          </div>
          
          <div className="flex flex-col md:flex-row gap-8 items-start relative z-10">
            <div className="w-full md:w-1/3">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[#E50000] font-black text-4xl opacity-20">0{priority.id}</span>
                <h4 className="text-xl font-bold text-white tracking-tight">{priority.title}</h4>
              </div>
              <div className="p-4 rounded-2xl bg-[#E50000]/10 border border-[#E50000]/20 flex items-center justify-between group-hover:scale-105 transition-transform">
                <span className="text-[10px] uppercase font-bold text-gray-500 tracking-widest">Target KPI</span>
                <span className="text-sm font-bold text-[#E50000]">{priority.kpi}</span>
              </div>
            </div>

            <div className="flex-1 w-full flex flex-col gap-3 justify-center">
              <p className="text-[10px] uppercase font-bold text-gray-500 tracking-widest mb-2 border-l-2 border-[#E50000] pl-3">Execution Path</p>
              <div className="flex flex-wrap gap-3">
                {priority.steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2 rounded-xl bg-white/5 border border-white/5 text-gray-400 group-hover:text-gray-200 transition-colors">
                    <span className="text-xs font-medium">{step}</span>
                    {i < priority.steps.length - 1 && <MoveRight size={14} className="opacity-20" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
