"use client";

import { motion } from "framer-motion";
import { Sparkles, Brain, Cpu, Rocket } from "lucide-react";

interface AIPhase {
  phase: string;
  tool: string;
  roi: string;
}

interface AIRoadmapProps {
  data: AIPhase[];
}

export function AIRoadmap({ data }: AIRoadmapProps) {
  const icons = [<Sparkles className="text-[#E50000]" />, <Brain className="text-blue-500" />, <Cpu className="text-purple-500" />, <Rocket className="text-yellow-500" />];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {data.map((item, idx) => (
        <motion.div
          key={idx}
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          transition={{ delay: idx * 0.1 }}
          viewport={{ once: true }}
          className="p-8 rounded-3xl border border-white/10 bg-[#151515] hover:bg-[#1a1a1a] transition-all shadow-2xl flex flex-col items-center text-center group"
        >
          <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
            {icons[idx % icons.length]}
          </div>
          <span className="text-[10px] uppercase font-black text-gray-500 tracking-[0.2em] mb-3">{item.phase}</span>
          <h4 className="text-xl font-bold text-white mb-4 group-hover:text-[#E50000]">{item.tool}</h4>
          <div className="mt-auto pt-6 border-t border-white/5 w-full">
            <span className="text-[10px] uppercase font-bold text-[#E50000] tracking-widest block mb-2">Projected Impact</span>
            <p className="text-sm text-gray-400 font-medium">{item.roi}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
