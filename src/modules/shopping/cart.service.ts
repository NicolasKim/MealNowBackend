import { Injectable } from '@nestjs/common'

@Injectable()
export class CartService {
  private carts = new Map<string, any>()
  getCart(userId: string) {
    const c = this.carts.get(userId)
    if (c) return c
    const cart = { id: 'cart', userId, items: [], totalPrice: 0, currency: 'CNY', status: 'open', createdAt: new Date(), updatedAt: new Date() }
    this.carts.set(userId, cart)
    return cart
  }
  addMissing(userId: string, items: any[]) {
    const cart = this.getCart(userId)
    cart.items.push(...items)
    cart.updatedAt = new Date()
    return cart
  }
}
