import { useCallback, useEffect, useRef, useState } from 'react';
import init, { Game } from './wasm/snake_core';

const GRID_WIDTH = 48;
const GRID_HEIGHT = 32;
const CELL_SIZE = 18;

const DIR_UP = 0;
const DIR_RIGHT = 1;
const DIR_DOWN = 2;
const DIR_LEFT = 3;

const CELL_EMPTY = 0;
const CELL_BODY = 1;
const CELL_HEAD = 2;
const CELL_FOOD = 3;

type GameState = 'loading' | 'running' | 'paused' | 'over';
type CheatOptionId = 'invincible' | 'multiplier' | 'random-growth';

interface CheatOption {
  id: CheatOptionId;
  title: string;
  sub: string;
}

const CHEAT_OPTIONS: readonly CheatOption[] = [
  {
    id: 'invincible',
    title: '无敌模式',
    sub: '允许撞墙/撞身体',
  },
  {
    id: 'multiplier',
    title: '10 倍得分',
    sub: '每次吃到食物得分 x10',
  },
  {
    id: 'random-growth',
    title: '随机增长',
    sub: '每次进食后额外增长 1~6',
  },
];

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const memoryRef = useRef<WebAssembly.Memory | null>(null);
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const lagRef = useRef<number>(0);

  const statusRef = useRef<GameState>('loading');
  const menuOpenRef = useRef(false);
  const shouldResumeRef = useRef(false);

  const menuIndexRef = useRef(0);
  const invincibleRef = useRef(false);
  const multiplierRef = useRef(false);
  const randomGrowthRef = useRef(false);

  const [status, setStatus] = useState<GameState>('loading');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    if (typeof window === 'undefined') {
      return 0;
    }

    const stored = window.localStorage.getItem('snake-high-score');
    if (!stored) {
      return 0;
    }

    const parsed = Number.parseInt(stored, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });

  const [cheatOpen, setCheatOpen] = useState(false);
  const [selectedCheatIndex, setSelectedCheatIndex] = useState(0);
  const [invincible, setInvincible] = useState(false);
  const [multiplierEnabled, setMultiplierEnabled] = useState(false);
  const [randomGrowthEnabled, setRandomGrowthEnabled] = useState(false);

  const drawBoard = useCallback(() => {
    const game = gameRef.current;
    const memory = memoryRef.current;
    const canvas = canvasRef.current;
    if (!game || !memory || !canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const width = game.width();
    const height = game.height();
    const ptr = game.board_ptr();
    const len = game.board_len();
    const cells = new Uint8Array(memory.buffer, ptr, len);
    const isInvincible = invincibleRef.current;
    const pulse = isInvincible ? (Math.sin(performance.now() / 120) + 1) * 0.5 : 0;

    context.clearRect(0, 0, width * CELL_SIZE, height * CELL_SIZE);
    const background = context.createLinearGradient(0, 0, 0, height * CELL_SIZE);
    background.addColorStop(0, isInvincible ? '#041725' : '#0b2b27');
    background.addColorStop(1, isInvincible ? '#062a49' : '#0b2b27');
    context.fillStyle = background;
    context.fillRect(0, 0, width * CELL_SIZE, height * CELL_SIZE);

    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i];
      if (cell === CELL_EMPTY) {
        continue;
      }

      const x = (i % width) * CELL_SIZE;
      const y = Math.floor(i / width) * CELL_SIZE;

      if (cell === CELL_BODY) {
        context.fillStyle = isInvincible
          ? `rgba(80, 255, 226, ${0.68 + pulse * 0.12})`
          : '#5ef38f';
      } else if (cell === CELL_HEAD) {
        context.fillStyle = isInvincible
          ? `rgba(255, 255, 150, ${0.86 + pulse * 0.11})`
          : '#f5f543';
      } else if (cell === CELL_FOOD) {
        context.fillStyle = isInvincible ? '#ff8080' : '#ff5d5d';
      }

      if (isInvincible) {
        context.shadowColor = '#76ffe8';
        context.shadowBlur = 7;
      } else {
        context.shadowBlur = 0;
      }

      context.fillRect(x, y, CELL_SIZE, CELL_SIZE);
      context.shadowBlur = 0;
    }

    for (let x = 0; x <= width; x += 1) {
      context.beginPath();
      context.moveTo(x * CELL_SIZE + 0.5, 0);
      context.lineTo(x * CELL_SIZE + 0.5, height * CELL_SIZE);
      context.strokeStyle = isInvincible ? '#3b6b62bb' : '#16302f';
      context.lineWidth = isInvincible ? 3.2 : 2.8;
      context.stroke();
    }

    for (let y = 0; y <= height; y += 1) {
      context.beginPath();
      context.moveTo(0, y * CELL_SIZE + 0.5);
      context.lineTo(width * CELL_SIZE, y * CELL_SIZE + 0.5);
      context.strokeStyle = isInvincible ? '#3b6b62bb' : '#16302f';
      context.lineWidth = isInvincible ? 3.2 : 2.8;
      context.stroke();
    }
  }, []);

  const syncState = useCallback((next: GameState) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const applyCheatOption = useCallback((option: CheatOptionId, enabled: boolean) => {
    const game = gameRef.current;

    if (option === 'invincible') {
      invincibleRef.current = enabled;
      setInvincible(enabled);
      game?.set_invincible(enabled);
    } else if (option === 'multiplier') {
      multiplierRef.current = enabled;
      setMultiplierEnabled(enabled);
      game?.set_score_multiplier(enabled ? 10 : 1);
    } else {
      randomGrowthRef.current = enabled;
      setRandomGrowthEnabled(enabled);
      game?.set_random_growth(enabled);
    }
  }, []);

  const setCheatMenuSelection = useCallback((next: number) => {
    const total = CHEAT_OPTIONS.length;
    const clamped = ((next % total) + total) % total;
    menuIndexRef.current = clamped;
    setSelectedCheatIndex(clamped);
  }, []);

  const moveCheatMenuSelection = useCallback(
    (delta: number) => {
      setCheatMenuSelection(menuIndexRef.current + delta);
    },
    [setCheatMenuSelection],
  );

  const togglePauseMode = useCallback(() => {
    if (statusRef.current === 'running') {
      syncState('paused');
      return;
    }

    if (statusRef.current === 'paused') {
      syncState('running');
    }
  }, [syncState]);

  const closeCheatMenu = useCallback(() => {
    menuOpenRef.current = false;
    setCheatOpen(false);

    if (shouldResumeRef.current && statusRef.current === 'paused') {
      syncState('running');
    }

    shouldResumeRef.current = false;
  }, [syncState]);

  const openCheatMenu = useCallback(() => {
    if (menuOpenRef.current) {
      return;
    }

    menuOpenRef.current = true;
    setCheatOpen(true);
    setCheatMenuSelection(0);

    shouldResumeRef.current = statusRef.current === 'running';
    if (shouldResumeRef.current) {
      syncState('paused');
    }
  }, [setCheatMenuSelection, syncState]);

  const toggleCurrentCheatOption = useCallback(() => {
    const option = CHEAT_OPTIONS[menuIndexRef.current];
    if (!option) {
      return;
    }

    if (option.id === 'invincible') {
      applyCheatOption('invincible', !invincibleRef.current);
    } else if (option.id === 'multiplier') {
      applyCheatOption('multiplier', !multiplierRef.current);
    } else {
      applyCheatOption('random-growth', !randomGrowthRef.current);
    }
  }, [applyCheatOption]);

  const selectCheatOption = useCallback(
    (optionIndex: number) => {
      if (optionIndex < 0 || optionIndex >= CHEAT_OPTIONS.length) {
        return;
      }

      setCheatMenuSelection(optionIndex);
    },
    [setCheatMenuSelection],
  );

  const applyCheatDefaults = useCallback(() => {
    applyCheatOption('invincible', false);
    applyCheatOption('multiplier', false);
    applyCheatOption('random-growth', false);
  }, [applyCheatOption]);

  const restart = useCallback(() => {
    const game = gameRef.current;
    if (!game) {
      return;
    }

    game.reset();
    applyCheatDefaults();
    closeCheatMenu();

    syncState('running');

    lastFrameRef.current = 0;
    lagRef.current = 0;
    setScore(0);
    drawBoard();
  }, [applyCheatDefaults, closeCheatMenu, drawBoard, syncState]);

  useEffect(() => {
    let mounted = true;
    let raf = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      const game = gameRef.current;
      if (!game || statusRef.current === 'loading') {
        return;
      }

      const isMenuKey = event.key === '\\' || event.code === 'Backslash';
      if (isMenuKey) {
        event.preventDefault();

        if (menuOpenRef.current) {
          closeCheatMenu();
          return;
        }

        openCheatMenu();
        return;
      }

      if (menuOpenRef.current) {
        const key = event.key.toLowerCase();

        if (key === 'escape') {
          event.preventDefault();
          closeCheatMenu();
          return;
        }

        if (key === 'enter') {
          event.preventDefault();
          toggleCurrentCheatOption();
          return;
        }

        if (key === 'arrowup' || key === 'w') {
          event.preventDefault();
          moveCheatMenuSelection(-1);
          return;
        }

        if (key === 'arrowdown' || key === 's') {
          event.preventDefault();
          moveCheatMenuSelection(1);
          return;
        }

        if (key >= '1' && key <= '3') {
          event.preventDefault();
          const optionIndex = Number.parseInt(key, 10) - 1;
          if (Number.isNaN(optionIndex) === false) {
            selectCheatOption(optionIndex);
          }
          return;
        }

        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'escape') {
        event.preventDefault();
        togglePauseMode();
        return;
      }

      if (statusRef.current === 'paused') {
        return;
      }

      if (statusRef.current === 'over') {
        syncState('running');
      }

      let direction: number | null = null;
      if (key === 'arrowup' || key === 'w') {
        direction = DIR_UP;
      } else if (key === 'arrowright' || key === 'd') {
        direction = DIR_RIGHT;
      } else if (key === 'arrowdown' || key === 's') {
        direction = DIR_DOWN;
      } else if (key === 'arrowleft' || key === 'a') {
        direction = DIR_LEFT;
      }

      if (direction !== null) {
        game.set_direction(direction);
        event.preventDefault();
      }
    };

    const frame = (time: number) => {
      const game = gameRef.current;
      if (!mounted || !game) {
        return;
      }

      if (statusRef.current === 'running') {
        if (lastFrameRef.current === 0) {
          lastFrameRef.current = time;
        }

        const delta = time - lastFrameRef.current;
        lastFrameRef.current = time;
        lagRef.current += delta;

        const tick = game.tick_interval_ms();
        while (lagRef.current >= tick) {
          const alive = game.tick();
          lagRef.current -= tick;

          if (!alive) {
            syncState('over');
            const finalScore = game.score();
            setScore(finalScore);

            setHighScore((current) => {
              const updated = Math.max(current, finalScore);
              window.localStorage.setItem('snake-high-score', String(updated));
              return updated;
            });

            break;
          }
        }

        if (statusRef.current === 'running') {
          setScore(game.score());
        }
      }

      drawBoard();
      raf = requestAnimationFrame(frame);
      rafRef.current = raf;
    };

    const initGame = async () => {
      const module = await init();
      if (!mounted) {
        return;
      }

      memoryRef.current = (module as unknown as { memory: WebAssembly.Memory }).memory;
      const game = new Game(GRID_WIDTH, GRID_HEIGHT, 90);
      gameRef.current = game;

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = GRID_WIDTH * CELL_SIZE;
        canvas.height = GRID_HEIGHT * CELL_SIZE;
      }

      syncState('running');
      applyCheatDefaults();
      drawBoard();

      window.addEventListener('keydown', onKeyDown, { passive: false });
      raf = requestAnimationFrame(frame);
      rafRef.current = raf;
    };

    initGame();

    return () => {
      mounted = false;
      window.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(rafRef.current);

      if (gameRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gameRef.current as unknown as { free: () => void }).free?.();
        gameRef.current = null;
      }
    };
  }, [
    applyCheatDefaults,
    closeCheatMenu,
    drawBoard,
    moveCheatMenuSelection,
    openCheatMenu,
    selectCheatOption,
    setCheatMenuSelection,
    syncState,
    toggleCurrentCheatOption,
    togglePauseMode,
    applyCheatOption,
  ]);

  const statusText =
    status === 'loading'
      ? '加载中'
      : status === 'running'
        ? '进行中'
        : status === 'paused'
          ? '暂停'
          : '游戏结束';

  const renderCheatState = (id: CheatOptionId) => {
    if (id === 'invincible') {
      return invincible ? 'ON' : 'OFF';
    }

    if (id === 'multiplier') {
      return multiplierEnabled ? 'ON' : 'OFF';
    }

    return randomGrowthEnabled ? 'ON' : 'OFF';
  };

  return (
    <div className="page">
      <div className="hud">
        <h1>Rust 高性能贪吃蛇</h1>
        <div className="stats">
          <span>分数：{score}</span>
          <span>最高：{highScore}</span>
          <span>状态：{statusText}</span>
        </div>
        <button type="button" className="restart-btn" onClick={restart}>
          重新开始
        </button>
      </div>
      <div className="game-wrap">
        <canvas
          ref={canvasRef}
          className={invincible ? 'game-canvas game-canvas-invincible' : 'game-canvas'}
          aria-label="game board"
        />
        {cheatOpen && (
          <div className="cheat-panel">
            <div className="cheat-title-row">
              <span className="cheat-title">GTA CHEAT MENU</span>
              <span className={`cheat-mode-pill ${status === 'paused' ? 'is-on' : 'is-off'}`}>PAUSED</span>
            </div>
            <div className="cheat-tip">按 W/S 或 ↑/↓ 选择，Enter 切换，ESC 退出菜单</div>
            <ul className="cheat-options">
              {CHEAT_OPTIONS.map((option, index) => {
                const isActive = index === selectedCheatIndex;
                const value = renderCheatState(option.id);

                return (
                  <li
                    key={option.id}
                    className={`cheat-option ${isActive ? 'is-active' : ''}`}
                    onMouseEnter={() => setCheatMenuSelection(index)}
                  >
                    <span className="cheat-option-index">{index + 1}</span>
                    <div className="cheat-option-text">
                      <span className="cheat-option-title">{option.title}</span>
                      <span className="cheat-option-sub">{option.sub}</span>
                    </div>
                    <span className={`cheat-option-state ${value === 'ON' ? 'is-on' : 'is-off'}`}>{value}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
      {status === 'over' && <div className="overlay">Game Over</div>}
      <p className="tip">方向键或 WASD 控制方向；Esc 暂停/恢复。</p>
    </div>
  );
}

export default App;
