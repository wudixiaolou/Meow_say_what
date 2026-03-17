Hi, I’m Chunlin Guan, and my product is called **Meowlingo**.

<br />

Cat owners frequently run into scenarios just like these:

Kitty: “**Meow\~**”&#x20;

Human: “What are you saying? I don’t understand.”

Human: “Come on！”&#x20;

Kitty: “**Silly human.**”

<br />

I believe that cat owners, especially first-time parents, are incredibly curious about what their cats’ meows and body language actually mean. They desperately want to understand them so they can provide **immediate** and **appropriate** responses.

Unfortunately, there is a **major barrier** when it comes to cross-species communication. Humans simply can’t decipher their cats’ intentions, making it incredibly hard to respond correctly.

<br />

However, AI—specifically **multimodal AI**—possesses two core capabilities:

First, inferring **intent** across species through visual, audio, and textual data.

Second, generating **high-quality** text and audio to provide feedback.

<br />

This breaks down communication barriers, creating a **closed loop** between humans and other species.

<br />

“The era of true cross-species communication might finally be here.”

<br />

So my product definition is:

Providing a **frictionless communication method** for people facing cross-species language barriers in scenarios with frequent communication needs.

<br />

Its core features are:

First, **Real-time Translation**: Captures the cat’s vocalizations and body language through camera and microphone in real time to deduce the cat’s intentions, and tells the owner its thoughts from the cat’s first-person perspective.

Second, **Actionable Responses**: Provides actionable response suggestions, and recommends or emits appropriate cat sounds to respond to the cat’s needs, forming a complete “human-feline communication loop.”

<br />

In addition, it includes two additional features:

First, **Record every day**: Generates a multimedia diary (combining text, video, and audio) from the cat’s first-person perspective, which can be browsed at any time in the calendar.

Second, **Capture Highlights**: Human-cat interactions often happen in a flash—usually ending before you can even grab your phone. The app automatically captures these highlights, making it easy for users to share them directly to their social media.

<br />

At the system level, it is built as one **real-time** core loop plus parallel extension paths.&#x20;

The client captures audio/video continuously, keeps a short rolling buffer, and sends both streams into one Gemini Live session for **multimodal understanding**, interruption handling, and live dialogue. In parallel, a FastAPI service with YAMNet/Intent Head adds vocal-intent confidence as supporting evidence, then orchestration fuses motion, sound, and context. Outputs are operational: **first-person cat translation**, **actionable owner guidance**, and optional cat-sound reply to close the loop. Meanwhile, highlights and diary generation run in parallel; highlight media can feed diary creation without blocking real-time flow. Finally, deployment uses **GitHub Actions**, **Cloud Build/Artifact Registry**, and **Cloud Run**.

<br />

There are many AI companionship products on the market where AI simulates humans or pets for voice chat.
However, I believe AI should **not replace pets** for companionship. Instead, it should serve as an **emotional connector** between humans and their pets.
