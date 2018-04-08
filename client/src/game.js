import { throttle, range } from 'lodash';
import config from '../config';
import socket from './socket';
import Phaser from './Phaser';
import nanoid from 'nanoid';

const width = 960;
const height = 540;
const woodRespawnDelay = 5000; // ms

const center = {x: width / 2, y: height / 2};

export default function startGame() {
  return new Phaser.Game({
    width, height,
    parent: 'game',
    type: Phaser.AUTO,
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { y: 200 },
      },
    },
    scene: { preload, create },
  });
}

function preload() {
  this.load.setBaseURL(config.server);
  this.load.image('background', require('./assets/background.png'));
  this.load.image('log_a', require('./assets/log_a.png'));
  this.load.image('log_b', require('./assets/log_b.png'));
  this.load.image('log_c', require('./assets/log_c.png'));
  this.load.image('trees', require('./assets/trees.png'));
  this.load.atlas('campingscene', require('./assets/scene.png'), require('file-loader!./assets/scene.json'));
}

function create() {
  const sessionId = nanoid();
  const game = this;
  const logs = new Map();
  const sticks = new Map();
  const foxPosition = {
    x: -100,
    y: height - 100,
  };
  const foxTextBubblePosition = {
    x: foxPosition.x + 280,
    y: foxPosition.y - 90
  };
  const firePosition = {
    x: 300,
    y: height - 20,
  };
  const draggableLogAreaPosition = {
    x: width * 0.8,
    y: height - 50,
  };
  const foxTextPosition = {
    x: foxTextBubblePosition.x - 40,
    y: foxTextBubblePosition.y - 10,
  };

  const background = this.add.sprite(center.x, center.y, 'campingscene', 'background.png').setScale(0.5);
  const trees = this.add.image(width - 25, center.y, 'trees').setScale(0.35);
  const fox = this.add.sprite(foxPosition.x, foxPosition.y, 'campingscene', 'fawkes_side.png').setScale(0.5);
  const foxTextBubble = this.add.sprite(foxTextBubblePosition.x, foxTextBubblePosition.y, 'campingscene', 'speech_bubble_a.png').setScale(0.5);
  const foxText = this.add.text(foxTextPosition.x, foxTextPosition.y, 'That looks tasty!', {
    font: '15px arial',
    fill: '#000000'
  });
  const foxMouthArea = {
    x: fox.x + 150,
    y: fox.y - 75,
    width: 50,
    height: 50
  };
  fox.alpha = 0;
  foxTextBubble.alpha = 0;
  foxText.alpha = 0;

  // Add fire and static logs around it
  createLog({x: firePosition.x - 50, y: firePosition.y - 50, spriteId: 'log_c'});
  createLog({x: firePosition.x + 50, y: firePosition.y - 40, spriteId: 'log_a'});
  const fire = createFire();
  createLog({x: firePosition.x - 50, y: firePosition.y - 10, spriteId: 'log_a'});
  createLog({x: firePosition.x + 20, y: firePosition.y - 10, spriteId: 'log_b'});

  // Add draggable sticks with marshmallows
  createDraggableStick({x: 375, y: height - 150, spriteId: 'stick_a.png'});
  createDraggableStick({x: 400, y: height - 150, spriteId: 'stick_b.png'});

  // Add draggable logs
  const draggableLogs = ['log_a', 'log_b', 'log_c'].map((spriteId, i) => {
    return createDraggableLog({
      spriteId,
      x: draggableLogAreaPosition.x + (i * 50),
      y: draggableLogAreaPosition.y + ((Math.random() * 50) - 25)
    });
  });

  socket.on('grabLog', createLog);

  socket.on('moveLog', remoteLog => {
    const log = logs.get(remoteLog.id);
    if(log) {
      log.updatePosition(remoteLog.x, remoteLog.y);
    } else {
      createLog(remoteLog);
    }
  });

  socket.on('dropLog', remoteLog => {
    const log = logs.get(remoteLog.id);
    if(log) {
      log.getSprite().destroy();
      logs.delete(log.id);
    }
  });

  socket.on('grabStick', createStick);
  socket.on('moveStick', remoteStick => {
    const stick = sticks.get(remoteStick.id);
    if(stick) {
      stick.updatePosition(remoteStick.x, remoteStick.y);
    } else {
      createStick(remoteStick);
    }
  });

  socket.on('dropStick', remoteStick => {
    const stick = sticks.get(remoteStick.id);
    if(stick) {
      Object.values(stick.getSprites()).forEach(sprite => sprite.destroy());
      sticks.delete(stick.id);
    }
  });

  socket.on('cook', remoteStick => {
    const stick = sticks.get(remoteStick.id);
    if(stick) {
      stick.setCookLevel(remoteStick.cookLevel);
    }
  });

  socket.on('fireLevel', ({ fireLevel }) => setFireLevel(fireLevel));

  socket.on('init', ({ fireLevel, foxVisible }) => {
    setFireLevel(fireLevel);
    if(foxVisible) showFox();
  });

  socket.on('showFox', showFox);
  socket.on('foxFed', async () => {
    foxText.x = foxTextPosition.x + 30;
    foxText.setText('Yum!');
    await wait(1000);
    hideFox();
  });

  socket.emit('ready');

  function showFox() {
    foxText.x = foxTextPosition.x;
    foxText.setText('That looks tasty!');
    game.tweens.add({
      targets: [fox, foxText, foxTextBubble],
      alpha: 1,
      duration: 300
    });
  }

  function hideFox() {
    game.tweens.add({
      targets: [fox, foxText, foxTextBubble],
      alpha: 0,
      duration: 300
    });
  }

  function createLog({id, x, y, spriteId}) {
    const sprite = game.add.image(x, y, spriteId).setScale(0.5);
    const log = {
      id: id || nanoid(),
      initialX: x,
      initialY: y,
      sessionId,
      x, y, spriteId,
      getSprite() {
        return sprite;
      },
      updatePosition(x, y) {
        const sprite = log.getSprite();
        log.x = sprite.x = x;
        log.y = sprite.y = y;
      },
      reset(duration) {
        if(duration) {
          game.tweens.add({
            targets: [sprite],
            x, y,
            duration
          });
        } else {
          log.updatePosition(x, y);
        }
      },
    };
    logs.set(log.id, log);
    return log;
  }

  function createStick({ id, x, y, spriteId, cookLevel = 1 }) {
    const group = game.add.group();
    const stick = game.add.sprite(x, y, 'campingscene', spriteId).setScale(0.5);
    const marshmallowOffset = spriteId === 'stick_b.png'
      ? { x: 5, y: -65 }
      : { x: 0, y: -55 };

    const marshmallow = game.add.sprite(x + marshmallowOffset.x, y + marshmallowOffset.y, 'campingscene', 'cooking/1.png').setScale(0.25);

    const stickObject = {
      id: id || nanoid(),
      x, y, spriteId, cookLevel, sessionId,
      getSprites() {
        return {marshmallow, stick}
      },

      updatePosition(x, y) {
        this.x = x;
        this.y = y;
        stick.x = x;
        stick.y = y;
        marshmallow.x = x + marshmallowOffset.x;
        marshmallow.y = y + marshmallowOffset.y;
      },

      reset() {
        this.updatePosition(x, y);
        this.setCookLevel(1);
      },

      setCookLevel(cookLevel) {
        this.cookLevel = cookLevel;
        switch(cookLevel) {
          case 2: marshmallow.setTexture('campingscene', 'cooking/2.png'); break;
          case 3: marshmallow.setTexture('campingscene', 'cooking/3.png'); break;
          default: marshmallow.setTexture('campingscene', 'cooking/1.png');
        }
      }
    };

    stickObject.setCookLevel(cookLevel);
    sticks.set(stickObject.id, stickObject);

    return stickObject;
  }

  function createDraggableStick(props) {
    const stick = createStick(props);
    const sprites = stick.getSprites();
    let cookInterval = null;

    sprites.stick.setInteractive();
    game.input.setDraggable(sprites.stick);

    sprites.stick.on('dragstart', () => socket.emit('grabStick', stick));

    sprites.stick.on('drag', (pointer, x, y) => {
      stick.updatePosition(x, y);
      socket.emit('moveStick', stick);

      if(isOverlapping(sprites.marshmallow, fire)) {
        if(!cookInterval) cookInterval = setInterval(() => {
          if(stick.cookLevel < 3) {
            stick.setCookLevel(stick.cookLevel + 1);
            socket.emit('cook', stick);
          }
        }, 1000);
      } else {
        clearCookInterval();
      }
    });

    sprites.stick.on('dragend', () => {
      if(isPointInRect(sprites.marshmallow, foxMouthArea)) {
        socket.emit('feedFox', stick);
      }
      socket.emit('dropStick', stick);
      stick.reset();
      clearCookInterval();
    });

    function clearCookInterval() {
      if(cookInterval) {
        clearInterval(cookInterval);
        cookInterval = null;
      }
    }

    return stick;
  }

  function createDraggableLog(props) {
    const log = createLog(props);
    const sprite = log.getSprite();

    sprite.setInteractive();
    game.input.setDraggable(sprite);

    sprite.on('dragstart', () => socket.emit('grabLog', log));

    sprite.on('drag', (pointer, x, y) => {
      log.updatePosition(x, y);
      socket.emit('moveLog', log);
    });

    sprite.on('dragend', () => {
      socket.emit('dropLog', log);
      if(isOverlapping(sprite, fire)) {
        socket.emit('feedFire');
        log.reset(0);
        sprite.alpha = 0;

        setTimeout(() => {
          game.tweens.add({
            targets: [sprite],
            alpha: 1,
            duration: 300,
          });
        }, woodRespawnDelay);
      } else {
        log.reset(100);
      }
    });

    return log;
  }

  function createFire() {
    const fire = game.add.sprite(firePosition.x, firePosition.y, 'campingscene', 'small/1.png');
    const smallFireFrames = game.anims.generateFrameNames('campingscene', {
      start: 1,
      end: 3,
      zeroPad: 0,
      prefix: 'small/',
      suffix: '.png'
    });
    const largeFireFrames = game.anims.generateFrameNames('campingscene', {
      start: 1,
      end: 3,
      zeroPad: 0,
      prefix: 'large/',
      suffix: '.png'
    });

    game.anims.create({ key: 'small', frames: smallFireFrames, frameRate: 10, repeat: -1 });
    game.anims.create({ key: 'large', frames: largeFireFrames, frameRate: 10, repeat: -1 });

    return fire;
  }

  function setFireAnimation(animation) {
    fire.anims.play(animation);
    fire.x = firePosition.x;
    fire.y = firePosition.y - (fire.height / 2);
  }

  function setFireLevel(fireLevel) {
    if(fireLevel <= 5) {
      setFireAnimation('small');
    } else {
      setFireAnimation('large');
    }
  }

  function getTopLeft(sprite) {
    return {
      x: sprite.x - (sprite.width / 2),
      y: sprite.y - (sprite.height / 2),
    };
  }

  function isOverlapping(spriteA, spriteB) {
    const topLeft = getTopLeft(spriteB);
    return spriteA.x >= topLeft.x &&
      spriteA.y >= topLeft.y &&
      spriteA.x < (topLeft.x + spriteB.width) &&
      spriteA.y < (topLeft.y + spriteB.height);
  }

  function isPointInRect(point, rect) {
    return point.x >= rect.x &&
      point.y >= rect.y &&
      point.x < rect.x + rect.width &&
      point.y < rect.y + rect.height;
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
