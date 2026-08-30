import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus, Search, Star, Play } from "lucide-react";
import { motion } from "framer-motion";

const CATEGORIES = ["fantasy", "scifi", "modern", "historical", "mystery", "romance", "thriller"];

export default function TemplateHub() {
  const [templates, setTemplates] = useState([]);
  const [filteredTemplates, setFilteredTemplates] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    filterTemplates();
  }, [templates, search, selectedCategory]);

  const loadTemplates = async () => {
    const data = await base44.entities.ScenarioTemplate.list("-usage_count", 100);
    setTemplates(data || []);
    setLoading(false);
  };

  const filterTemplates = () => {
    let filtered = templates;

    if (selectedCategory !== "all") {
      filtered = filtered.filter((t) => t.category === selectedCategory);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags?.some((tag) => tag.toLowerCase().includes(q))
      );
    }

    setFilteredTemplates(filtered);
  };

  const handleUseTemplate = async (template) => {
    // Create a new session with this template
    const session = await base44.entities.ChatSession.create({
      title: template.title,
      mode: "solo",
      opening_scene: template.opening_prompt,
      world_details: template.world_details,
      template_id: template.id,
    });

    // Track usage
    await base44.entities.ScenarioTemplate.update(template.id, {
      usage_count: (template.usage_count || 0) + 1,
    });

    window.location.href = `/chat/${session.id}`;
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background scanline p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-primary/40 hover:text-primary transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-lg">Story Templates</h1>
              <p className="text-[9px] font-mono text-primary/30 tracking-widest uppercase">Pre-built scenarios to jump into</p>
            </div>
          </div>
          <Link
            to="/create-scenario"
            className="flex items-center gap-2 px-4 py-2 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 font-mono text-xs tracking-widest uppercase"
          >
            <Plus className="w-4 h-4" />
            Create
          </Link>
        </div>

        {/* Search & Filters */}
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/30" />
            <input
              type="text"
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm pl-10 pr-4 py-2.5 focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2">
            <button
              onClick={() => setSelectedCategory("all")}
              className={`px-4 py-2 font-mono text-xs tracking-widest uppercase whitespace-nowrap transition-all border ${
                selectedCategory === "all"
                  ? "bg-primary/10 border-primary/50 text-primary"
                  : "border-primary/15 text-primary/40 hover:border-primary/30"
              }`}
            >
              All Categories
            </button>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-2 font-mono text-xs tracking-widest uppercase whitespace-nowrap transition-all border capitalize ${
                  selectedCategory === cat
                    ? "bg-primary/10 border-primary/50 text-primary"
                    : "border-primary/15 text-primary/40 hover:border-primary/30"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Templates Grid */}
        {loading ? (
          <div className="text-center py-16">
            <p className="font-mono text-primary/40 text-sm">Loading templates...</p>
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="text-center py-16">
            <p className="font-mono text-primary/30 text-sm">No templates found. Try a different search or category.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTemplates.map((template) => (
              <motion.div
                key={template.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="border border-primary/15 bg-black/40 hover:border-primary/40 transition-all group cursor-pointer"
                onClick={() => handleUseTemplate(template)}
              >
                {/* Header */}
                <div className="p-4 border-b border-primary/10 space-y-2">
                  <h3 className="font-mono text-sm text-primary tracking-wider uppercase">{template.title}</h3>
                  <p className="text-[9px] text-primary/50 line-clamp-2">{template.description}</p>
                </div>

                {/* Details */}
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between text-[9px] font-mono">
                    <span className="text-primary/40">Difficulty</span>
                    <span className="text-primary/70 capitalize">{template.difficulty || "intermediate"}</span>
                  </div>

                  <div className="flex items-center justify-between text-[9px] font-mono">
                    <span className="text-primary/40">Duration</span>
                    <span className="text-primary/70">{template.estimated_duration || "2-4h"}</span>
                  </div>

                  {template.rating && (
                    <div className="flex items-center justify-between text-[9px] font-mono">
                      <span className="text-primary/40">Rating</span>
                      <div className="flex items-center gap-1">
                        <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                        <span className="text-primary/70">{template.rating.toFixed(1)}</span>
                      </div>
                    </div>
                  )}

                  {template.usage_count > 0 && (
                    <div className="flex items-center justify-between text-[9px] font-mono">
                      <span className="text-primary/40">Used</span>
                      <span className="text-primary/70">{template.usage_count} times</span>
                    </div>
                  )}

                  {template.tags && template.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-2">
                      {template.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="text-[8px] px-2 py-1 bg-primary/10 text-primary/70 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* CTA */}
                <div className="p-4 border-t border-primary/10 flex items-center justify-between">
                  <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">Use Template</span>
                  <Play className="w-4 h-4 text-primary/40 group-hover:text-primary transition-colors" />
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}