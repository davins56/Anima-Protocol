import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Loader, MapPin } from "lucide-react";

export default function LocationVisitTracker({ sessionId }) {
  const [visitedLocations, setVisitedLocations] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (sessionId) {
      loadVisitedLocations();
    }
  }, [sessionId]);

  const loadVisitedLocations = async () => {
    setLoading(true);
    try {
      // Get all locations marked as visited for this session
      const locations = await base44.entities.Location.filter(
        { visited: true, first_visit_session_id: sessionId },
        "-created_date",
        50
      );
      setVisitedLocations(locations || []);
    } catch (err) {
      console.error("Error loading visited locations:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-3 border border-primary/20 bg-primary/5 rounded flex items-center gap-2">
        <Loader className="w-3 h-3 text-primary/40 animate-spin" />
        <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          Loading visited locations...
        </span>
      </div>
    );
  }

  if (visitedLocations.length === 0) {
    return null;
  }

  return (
    <div className="border border-primary/20 bg-primary/5 rounded p-3 space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <MapPin className="w-3 h-3 text-primary/60" />
        <p className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          Visited Locations ({visitedLocations.length})
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visitedLocations.map((loc) => (
          <span
            key={loc.id}
            className="px-2.5 py-1 bg-primary/10 border border-primary/20 text-primary/70 font-mono text-[8px] tracking-wider rounded"
          >
            {loc.name}
          </span>
        ))}
      </div>
    </div>
  );
}