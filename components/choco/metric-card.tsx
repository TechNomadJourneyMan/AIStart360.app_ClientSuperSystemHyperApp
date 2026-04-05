"use client";

import { motion } from "framer-motion";
import { Activity } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string;
  confidence: string;
  category: string;
  delay?: number;
}

export function MetricCard({ title, value, confidence, category, delay = 0 }: MetricCardProps) {
  const isHighConfidence = confidence === "HIGH";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      whileHover={{ scale: 1.02 }}
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#111111]/80 backdrop-blur-md p-6 shadow-2xl"
    >
      <div className="absolute top-0 right-0 p-4 opacity-10">
        <Activity size={80} />
      </div>
      
      <div className="relative z-10 flex flex-col justify-between h-full">
        <div className="flex justify-between items-start mb-4">
          <span className="text-sm font-medium text-gray-400 uppercase tracking-wider">{category}</span>
          <span className={`text-xs px-2 py-1 rounded-full ${isHighConfidence ? 'bg-[#E50000]/20 text-[#E50000]' : 'bg-gray-800 text-gray-300'}`}>
            {confidence}
          </span>
        </div>
        
        <div>
          <h3 className="text-3xl font-bold text-white mb-1 group-hover:text-[#E50000] transition-colors">{value}</h3>
          <p className="text-sm text-gray-400">{title}</p>
        </div>
      </div>
      
      {/* Decorative gradient line */}
      <div className="absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r from-transparent via-[#E50000] to-transparent opacity-50" />
    </motion.div>
  );
}
