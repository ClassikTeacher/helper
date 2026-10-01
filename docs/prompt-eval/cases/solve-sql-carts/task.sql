-- Схема (PostgreSQL)
CREATE TABLE products (
  id        BIGINT PRIMARY KEY,
  name      TEXT NOT NULL,
  is_active BOOLEAN NOT NULL
);

CREATE TABLE carts (
  id         BIGINT PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE cart_items (
  cart_id    BIGINT NOT NULL REFERENCES carts(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty        INT NOT NULL,
  PRIMARY KEY (cart_id, product_id)
);

-- Задача: вывести id и user_id корзин, в которых есть
-- хотя бы один неактивный товар. Каждая корзина — один раз.
