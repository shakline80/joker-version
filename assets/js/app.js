/**
 * Joker Box — Single-page game controller
 *
 * Game flow:
 *   Home → Height Reward → Magic Box → Flip Cards → Claim Win → Home
 *
 * Navigation:
 *   Links use data-screen="screen-id" to switch screens.
 *   Add data-with-sound="true" to enable video audio (user gesture required).
 *
 * Flip card win stages (after all 5 cards are flipped):
 *   winStage 1 → first tap anywhere advances
 *   winStage 2 → second tap opens Claim Win screen
 */

document.addEventListener('DOMContentLoaded', () => {

  // --- Screen IDs (must match index.html main#id values) ---
  const SCREENS = {
    home: 'screen-home',
    heightReward: 'screen-height-reward',
    magicBox: 'screen-magic-box',
    flipCard: 'screen-flip-card',
    claimWin: 'screen-claim-win',
  };

  const MAGIC_PLAYBACK_RATE = 4.0; // Magic box videos play 4× faster

  // --- State ---
  let currentScreen = SCREENS.home;
  let winStage = 0;           // Flip-card progress after all cards are revealed
  let magicSequenceId = 0;    // Cancels magic video chain when user skips or leaves
  let autoAdvanceTimer = null; // Auto-advance from flip cards to claim win

  // --- DOM references ---
  const cardSound = document.getElementById('cardSound');
  const winSound = document.getElementById('winSound');
  const jokerButtons = document.querySelectorAll('.select-joker button');
  const openButton = document.querySelector('.open-button');
  const flipCardScreen = document.getElementById(SCREENS.flipCard);

  // On first load, show home screen instantly — no fade-in on initial paint
  const homeScreen = document.getElementById(SCREENS.home);
  if (homeScreen) {
    homeScreen.classList.add('no-transition', 'active');
    // Strip no-transition after one frame so future transitions work
    requestAnimationFrame(() => homeScreen.classList.remove('no-transition'));
  }

  // Pre-warm screen 2 video so it has frames ready when the screen fades in
  const prewarmVideo = document.getElementById('myVideo');
  if (prewarmVideo) {
    prewarmVideo.muted = true;
    prewarmVideo.play().then(() => prewarmVideo.pause()).catch(() => {});
  }

  /** Cancel any pending auto-advance timer. */
  function clearAutoAdvance() {
    if (autoAdvanceTimer !== null) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
  }

  /** Pause every video/audio so nothing keeps playing in the background. */
  function pauseAllMedia() {
    clearAutoAdvance();
    document.querySelectorAll('video').forEach(video => {
      video.pause();
      video.onended = null;
    });

    [cardSound, winSound].forEach(audio => {
      if (!audio) return;
      audio.pause();
      audio.currentTime = 0;
    });
  }

  /** Bump the sequence ID so in-flight magic video callbacks are ignored. */
  function abortMagicSequence() {
    magicSequenceId += 1;
  }

  /**
   * Crossfade screens. For the magic→flipcard transition, screen 4 is
   * made visible first (z-index 10) then screen 3 fades out behind it —
   * both overlap at the same position so the card area looks continuous.
   */
  function showScreen(screenId, options = {}) {
    if (screenId === currentScreen) return;

    abortMagicSequence();
    pauseAllMedia();

    const outgoing = document.getElementById(currentScreen);
    const nextScreen = document.getElementById(screenId);
    if (!nextScreen) return;

    const fromMagicToFlip = (currentScreen === SCREENS.magicBox && screenId === SCREENS.flipCard);

    currentScreen = screenId;

    requestAnimationFrame(() => {
      if (screenId === SCREENS.heightReward) {
        const v = document.getElementById('myVideo');
        if (v) { v.muted = !(options.withSound); v.currentTime = 0; v.play().catch(() => {}); }
      }

      if (fromMagicToFlip) {
        // Screen 4 activates immediately at z-index 10 (cards visible)
        nextScreen.classList.add('active');
        initFlipCardVideo();
        winStage = 0;

        // Screen 3 fades out behind screen 4 — seamless overlap
        if (outgoing) {
          outgoing.classList.remove('active');
          outgoing.classList.add('leaving');
          outgoing.addEventListener('transitionend', () => {
            outgoing.classList.remove('leaving');
          }, { once: true });
        }
      } else {
        // Normal crossfade for all other screen transitions
        if (outgoing) {
          outgoing.classList.remove('active');
          outgoing.classList.add('leaving');
          outgoing.addEventListener('transitionend', () => {
            outgoing.classList.remove('leaving');
          }, { once: true });
        }

        nextScreen.classList.add('active');
        document.body.classList.toggle('with-menubar', screenId === SCREENS.home);

        switch (screenId) {
          case SCREENS.home:
            resetGameState();
            break;
          case SCREENS.heightReward:
            initHeightRewardVideo(Boolean(options.withSound));
            break;
          case SCREENS.magicBox:
            startMagicSequence();
            break;
          case SCREENS.flipCard:
            winStage = 0;
            initFlipCardVideo();
            break;
          case SCREENS.claimWin:
            playWinSound();
            const winVideo = nextScreen.querySelector('.video-win-bg');
            if (winVideo) {
              winVideo.muted = false;
              winVideo.currentTime = 0;
              winVideo.play().catch(() => {
                winVideo.muted = true;
                winVideo.play().catch(() => {});
              });
            }
            break;
        }
      }
    });
  }

  /** Reset letters, cards, and magic videos when returning home. */
  function resetGameState() {
    winStage = 0;
    clearAutoAdvance();

    jokerButtons.forEach(btn => btn.classList.remove('selected'));
    openButton?.classList.remove('active');

    flipCardScreen?.querySelectorAll('.flip-card-single').forEach(card => {
      card.classList.remove('is-flipped');
      card.style.animation = ''; // restore entrance animation for next round
    });

    // Reset entrance wrap animations so they replay next round
    flipCardScreen?.querySelectorAll('.card-entrance-wrap').forEach(wrap => {
      wrap.style.animation = 'none';
      requestAnimationFrame(() => { wrap.style.animation = ''; });
    });

    // Remove active from flip screen so card-box opacity resets for next entry
    document.getElementById(SCREENS.flipCard)?.classList.remove('active');

    document.querySelectorAll('#screen-magic-box .video-step').forEach(step => {
      step.classList.remove('active');
    });

    document.querySelectorAll('#screen-magic-box .video-bg').forEach(video => {
      video.currentTime = 0;
    });
  }

  /** Height Reward background loop — unmuted only when opened from Joker Box tap. */
  function initHeightRewardVideo(withSound) {
    const video = document.getElementById('myVideo');
    if (!video) return;

    video.muted = !withSound;
    video.currentTime = 0;
    video.play().catch(() => {});
  }

  /** Play the magic box video, then go to flip cards. */
  function startMagicSequence() {
    const sequenceId = magicSequenceId + 1;
    magicSequenceId = sequenceId;

    const steps = document.querySelectorAll('#screen-magic-box .video-step');
    const video = document.querySelector('#screen-magic-box .step-1-video');

    if (!video) return;

    // Show the step
    steps.forEach(s => s.classList.remove('active'));
    steps[0]?.classList.add('active');

    video.currentTime = 0;
    video.playbackRate = MAGIC_PLAYBACK_RATE;
    video.play().catch(() => {});

    video.onended = () => {
      if (sequenceId !== magicSequenceId) return;
      showScreen(SCREENS.flipCard);
    };
  }

  /** Flip card background video — always plays with sound (user already tapped). */
  function initFlipCardVideo() {
    const video = document.getElementById('myVideoTwo');
    if (!video) return;

    video.muted = false;
    video.currentTime = 0;
    video.play().catch(() => {
      // Fallback: if autoplay with sound is blocked, play muted
      video.muted = true;
      video.play().catch(() => {});
    });
  }

  function checkAllFlipped() {
    const cards = flipCardScreen?.querySelectorAll('.flip-card-single') ?? [];
    return [...cards].every(card => card.classList.contains('is-flipped'));
  }

  function playWinSound() {
    if (!winSound) return;
    winSound.currentTime = 0;
    winSound.play().catch(() => {});
  }

  // --- Global click handler: navigation + flip-card win progression ---
  document.addEventListener('click', (e) => {

    // Any link with data-screen switches screens
    const navLink = e.target.closest('[data-screen]');
    if (navLink) {
      e.preventDefault();

      // OPEN NOW stays disabled until all J-O-K-E-R letters are selected
      if (navLink.classList.contains('open-button') && !navLink.classList.contains('active')) {
        return;
      }

      showScreen(navLink.dataset.screen, {
        withSound: navLink.dataset.withSound === 'true',
      });
      return;
    }

    // Tap magic video area → skip to flip cards with sound
    const magicWrapper = e.target.closest('.magic-wrapper');
    if (magicWrapper && currentScreen === SCREENS.magicBox) {
      e.preventDefault();
      showScreen(SCREENS.flipCard, { withSound: true });
      return;
    }
  });

  // Placeholder menu items (href="#") should not scroll the page
  document.querySelectorAll('a[href="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      if (!link.dataset.screen && !link.classList.contains('magic-wrapper')) {
        e.preventDefault();
      }
    });
  });

  // Height Reward — tap each J-O-K-E-R letter to unlock OPEN NOW
  jokerButtons.forEach(button => {
    button.addEventListener('click', () => {
      button.classList.toggle('selected');
      const allSelected = [...jokerButtons].every(btn => btn.classList.contains('selected'));
      openButton?.classList.toggle('active', allSelected);

      // Play the same card click sound as flip cards
      if (cardSound) {
        cardSound.currentTime = 0;
        cardSound.play().catch(() => {});
      }
    });
  });

  // Flip Card — tap a card once to reveal it
  flipCardScreen?.querySelectorAll('.flip-card-single').forEach(card => {
    card.addEventListener('click', (e) => {
      e.stopPropagation();

      if (card.classList.contains('is-flipped')) return;

      card.classList.add('is-flipped');

      // Once all cards are flipped, auto-advance to Claim Win
      if (checkAllFlipped() && winStage === 0) {
        winStage = 1;
        const delay = Math.floor(Math.random() * 1000) + 2000;
        autoAdvanceTimer = setTimeout(() => {
          if (currentScreen === SCREENS.flipCard) {
            showScreen(SCREENS.claimWin);
          }
        }, delay);
      }
    });
  });

  // History page tab filter (runs on history.html only)
  document.querySelectorAll('.tab-btn').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });
});
