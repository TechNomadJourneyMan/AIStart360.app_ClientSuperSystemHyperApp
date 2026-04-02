"use client";

import { motion } from "framer-motion";
import { AlertCircle, CheckCircle2, MinusCircle } from "lucide-react";

interface PestelData {
  factor: string;
  impact: string;
  status: "POSITIVE" | "RISK" | "NEUTRAL";
}

interface InteractiveDataGridProps {
  data: PestelData[];
}

export function InteractiveDataGrid({ data }: { data: any[] }) {
  const getStatusIcon = (status: string) => {
    switch(status) {
      case "POSITIVE": return <CheckCircle2 className="text-green-400" size={14} />;
      case "RISK": return <AlertCircle className="text-[#E50000]" size={14} />;
      case "NEUTRAL": return <MinusCircle className="text-gray-400" size={14} />;
      default: return null;
    }
  }

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, delay: 0.2 }}
      className="overflow-hidden rounded-3xl border border-white/10 bg-[#111111]/80 backdrop-blur-xl shadow-2xl flex flex-col h-[450px]"
    >
      <div className="p-8 border-b border-white/10 shrink-0 bg-[#151515]">
        <h3 className="text-xl font-bold text-white flex items-center">
          <span className="w-1.5 h-6 bg-[#E50000] rounded-full mr-4"></span>
          Strategic PESTEL Matrix
        </h3>
      </div>
      
      <div className="overflow-y-auto w-full flex-1 scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#1a1a1a] text-gray-500 uppercase text-[10px] tracking-widest font-bold sticky top-0 z-10 border-b border-white/5">
            <tr>
              <th className="px-8 py-5 w-1/4">Environment Factor</th>
              <th className="px-8 py-5">Strategic Impact</th>
              <th className="px-8 py-5">AI Recommendation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {data.map((item, i) => (
              <motion.tr 
                key={i}
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                viewport={{ once: true }}
                className="hover:bg-white/[0.02] transition-colors group cursor-default"
              >
                <td className="px-8 py-6">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{item.factor.split(' ')[0]}</span>
                    <span className="font-bold text-white tracking-tight">{item.factor.split(' ')[1]}</span>
                  </div>
                </td>
                <td className="px-8 py-6">
                  <p className="text-gray-400 group-hover:text-gray-200 transition-colors leading-relaxed font-medium">
                    {item.impact}
                  </p>
                </td>
                <td className="px-8 py-6">
                  <div className="flex flex-col gap-2">
                    <span className={`text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 ${
                      item.status === 'POSITIVE' ? 'text-green-400' : 'text-[#E50000]'
                    }`}>
                      {getStatusIcon(item.status)}
                      {item.status}
                    </span>
                    <p className="text-xs text-gray-500 italic">
                      {item.recommendation}
                    </p>
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
