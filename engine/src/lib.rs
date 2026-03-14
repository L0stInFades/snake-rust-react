use std::collections::VecDeque;

use wasm_bindgen::prelude::*;

const CELL_EMPTY: u8 = 0;
const CELL_SNAKE_BODY: u8 = 1;
const CELL_SNAKE_HEAD: u8 = 2;
const CELL_FOOD: u8 = 3;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Direction {
    Up = 0,
    Right = 1,
    Down = 2,
    Left = 3,
}

impl Direction {
    fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Up),
            1 => Some(Self::Right),
            2 => Some(Self::Down),
            3 => Some(Self::Left),
            _ => None,
        }
    }

    fn dxdy(self) -> (i16, i16) {
        match self {
            Self::Up => (0, -1),
            Self::Right => (1, 0),
            Self::Down => (0, 1),
            Self::Left => (-1, 0),
        }
    }

    fn opposite(self) -> Self {
        match self {
            Self::Up => Self::Down,
            Self::Right => Self::Left,
            Self::Down => Self::Up,
            Self::Left => Self::Right,
        }
    }
}

#[wasm_bindgen]
pub struct Game {
    width: u16,
    height: u16,
    tick_interval_ms: u32,
    board: Vec<u8>,
    snake: VecDeque<u16>,
    direction: Direction,
    next_direction: Direction,
    food: u16,
    score: u32,
    game_over: bool,
    invincible: bool,
    score_multiplier: u32,
    random_growth: bool,
    pending_growth: u32,
    rng_state: u64,
}

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u16, height: u16, tick_interval_ms: u32) -> Self {
        let width = width.max(1);
        let height = height.max(1);

        let mut game = Self::build(width, height, tick_interval_ms.max(20));
        game.food = game.spawn_food();
        game
    }

    pub fn width(&self) -> u16 {
        self.width
    }

    pub fn height(&self) -> u16 {
        self.height
    }

    pub fn tick_interval_ms(&self) -> u32 {
        self.tick_interval_ms
    }

    pub fn score(&self) -> u32 {
        self.score
    }

    pub fn is_game_over(&self) -> bool {
        self.game_over
    }

    pub fn food(&self) -> u16 {
        self.food
    }

    pub fn snake_len(&self) -> u32 {
        self.snake.len() as u32
    }

    pub fn is_invincible(&self) -> bool {
        self.invincible
    }

    pub fn is_random_growth(&self) -> bool {
        self.random_growth
    }

    pub fn score_multiplier(&self) -> u32 {
        self.score_multiplier
    }

    pub fn board_ptr(&self) -> *const u8 {
        self.board.as_ptr()
    }

    pub fn board_len(&self) -> u32 {
        self.board.len() as u32
    }

    pub fn set_direction(&mut self, dir: u8) {
        if self.game_over {
            return;
        }

        if let Some(next) = Direction::from_u8(dir) {
            if next != self.direction.opposite() {
                self.next_direction = next;
            }
        }
    }

    pub fn set_invincible(&mut self, value: bool) {
        self.invincible = value;
    }

    pub fn set_score_multiplier(&mut self, value: u32) {
        self.score_multiplier = if value == 0 { 1 } else { value };
    }

    pub fn set_random_growth(&mut self, value: bool) {
        self.random_growth = value;
    }

    pub fn tick(&mut self) -> bool {
        if self.game_over {
            return false;
        }

        let head = match self.snake.front().copied() {
            Some(cell) => cell,
            None => {
                self.game_over = true;
                return false;
            }
        };

        self.direction = self.next_direction;
        let direction = self.direction;
        let next = if self.invincible {
            Some(self.wrap_next_cell(head, direction))
        } else {
            self.next_cell(head, direction)
        };

        let next = match next {
            Some(cell) => cell,
            None => {
                self.game_over = true;
                return false;
            }
        };

        let next_was_food = next == self.food;
        let next_value = self.board[next as usize];

        if next_was_food {
            self.board[next as usize] = CELL_FOOD;
        }

        if !self.invincible && (next_value == CELL_SNAKE_BODY || next_value == CELL_SNAKE_HEAD) {
            let tail = self.snake.back().copied().unwrap_or_default();
            if next != tail {
                self.game_over = true;
                return false;
            }
        }

        let head_index = head as usize;
        if self.board[head_index] == CELL_SNAKE_HEAD {
            self.board[head_index] = CELL_SNAKE_BODY;
        }

        self.snake.push_front(next);
        self.board[next as usize] = CELL_SNAKE_HEAD;

        if next_was_food {
            self.score += self.score_multiplier;
            self.food = self.spawn_food();

            if self.random_growth {
                // Add a random growth tail-delay: 1~6 extra cells.
                self.pending_growth += (self.next_random_u32() % 6) + 1;
            }

            if self.food == u16::MAX {
                self.game_over = true;
            }
            return true;
        }

        if self.pending_growth == 0 {
            if let Some(tail) = self.snake.pop_back() {
                self.board[tail as usize] = CELL_EMPTY;
            }
        } else {
            self.pending_growth -= 1;
        }

        true
    }

    pub fn reset(&mut self) {
        *self = Self::new(self.width, self.height, self.tick_interval_ms);
    }
}

impl Game {
    fn build(width: u16, height: u16, tick_interval_ms: u32) -> Self {
        let size = width as usize * height as usize;
        let mut board = vec![CELL_EMPTY; size];

        let start_x = width / 2;
        let start_y = height / 2;
        let start = start_y as u16 * width + start_x;

        board[start as usize] = CELL_SNAKE_HEAD;

        let mut snake = VecDeque::with_capacity(size);
        snake.push_front(start);

        let mut seed = 0x9E37_79B9_7F4A_7C15u64 ^ (start as u64 * 0xBF58476D1CE4E5B9) ^ (size as u64 * 0x94D049BB133111EB);
        if seed == 0 {
            seed = 0xA076_1D64_78BD_642F;
        }

        Self {
            width,
            height,
            tick_interval_ms,
            board,
            snake,
            direction: Direction::Right,
            next_direction: Direction::Right,
            food: 0,
            score: 0,
            game_over: false,
            invincible: false,
            score_multiplier: 1,
            random_growth: false,
            pending_growth: 0,
            rng_state: seed,
        }
    }

    fn next_cell(&self, current: u16, direction: Direction) -> Option<u16> {
        let (dx, dy) = direction.dxdy();
        let x = (current % self.width) as i16;
        let y = (current / self.width) as i16;

        let next_x = x + dx;
        let next_y = y + dy;

        if next_x < 0 || next_y < 0 || next_x >= self.width as i16 || next_y >= self.height as i16 {
            return None;
        }

        let next = (next_y as u16) * self.width + next_x as u16;
        Some(next)
    }

    fn wrap_next_cell(&self, current: u16, direction: Direction) -> u16 {
        let (dx, dy) = direction.dxdy();
        let width = self.width as i16;
        let height = self.height as i16;
        let x = (current % self.width) as i16;
        let y = (current / self.width) as i16;

        let mut next_x = x + dx;
        let mut next_y = y + dy;

        if next_x < 0 {
            next_x = width - 1;
        } else if next_x >= width {
            next_x = 0;
        }

        if next_y < 0 {
            next_y = height - 1;
        } else if next_y >= height {
            next_y = 0;
        }

        (next_y as u16) * self.width + next_x as u16
    }

    fn next_random_u32(&mut self) -> u32 {
        self.rng_state ^= self.rng_state << 13;
        self.rng_state ^= self.rng_state >> 7;
        self.rng_state ^= self.rng_state << 17;

        (self.rng_state >> 16) as u32
    }

    fn spawn_food(&mut self) -> u16 {
        let total = self.board.len();
        if total == 0 {
            return u16::MAX;
        }

        for _ in 0..total {
            let idx = (self.next_random_u32() as usize) % total;
            if self.board[idx] == CELL_EMPTY {
                self.board[idx] = CELL_FOOD;
                return idx as u16;
            }
        }

        for (idx, cell) in self.board.iter_mut().enumerate() {
            if *cell == CELL_EMPTY {
                *cell = CELL_FOOD;
                return idx as u16;
            }
        }

        u16::MAX
    }
}
