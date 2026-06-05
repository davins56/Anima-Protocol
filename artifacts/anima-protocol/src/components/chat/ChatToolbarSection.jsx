// @ts-check
import ChatToolbar from './ChatToolbar';
import ChapterRecap from './ChapterRecap';

/** @param {import('react').ComponentProps<typeof ChatToolbar>} props */
export default function ChatToolbarSection(props) {
  return (
    <>
      <ChatToolbar {...props} />
      <div className="flex-shrink-0">
        <ChapterRecap sessionId={props.activeSession.id} isVisible={true} />
      </div>
    </>
  );
}