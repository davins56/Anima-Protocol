// @ts-check
import { useParams } from 'react-router-dom';
import QuestJournal from '@/components/quests/QuestJournal';

export default function QuestJournalPage() {
  const { sessionId } = useParams();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-6 md:p-8">
      <div className="max-w-3xl mx-auto">
        <QuestJournal sessionId={sessionId} isVisible={true} />
      </div>
    </div>
  );
}