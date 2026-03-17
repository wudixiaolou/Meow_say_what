# Findings

## Project Structure
- `src/App.tsx`: Main application logic.
- `src/components`: UI components.
- `lucide-react`: Icon library.
- `Tailwind CSS`: Styling.

## User Requirements Analysis
1.  **Cover Page**: "Meowlingo" icon, capsule "Start" button.
2.  **Language Switch**: Top-right corner.
3.  **Onboarding**: Role (Dad/Mom), Cat Name.
4.  **Main UI**:
    -   Full-screen video (remove mask).
    -   Camera icon button (replaces old button).
    -   Reposition status div.

## Implementation Details to Verify
-   Where is the current video rendering?
-   Where is the "mask/overlay"?
-   What state manages the current "start" action?
