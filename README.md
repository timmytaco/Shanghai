# Shanghai

An online multiplayer card game implementation of Shanghai Rummy.

## Tech Stack
- **Backend:** Node.js, Express, Socket.io
- **Frontend:** Vanilla HTML/CSS/JS
- **Containerization:** Docker

## Features
- Real-time multiplayer gameplay
- Round-robin randomization for fair play
- Lobby system for room creation and joining
- Chat system for player interaction

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) installed
- [Git](https://git-scm.com/) installed

### Installation
1. Clone the repository:
   ```bash
   git clone <repository-url>
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```

### Running with Docker
1. Build the image:
   ```bash
   docker build -t shanghai-rummy .
   ```
2. Run the container:
   ```bash
   docker run -p 3000:3000 shanghai-rummy
   ```

## License
MIT License
