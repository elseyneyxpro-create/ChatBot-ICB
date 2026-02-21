// 1. Importa las dependencias necesarias
import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  // 2. Inyecta JwtService para poder crear tokens
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Valida las credenciales de un usuario y, si son correctas,
   * genera un token de acceso JWT.
   * @param email El email del usuario.
   * @param pass La contraseña en texto plano.
   * @returns Un objeto con el token de acceso.
   */
  async signIn(email: string, pass: string): Promise<{ access_token: string }> {
    // a. Busca al usuario por su email
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // b. Si no existe el usuario o la contraseña no coincide, lanza un error
    if (!user || !(await bcrypt.compare(pass, user.password_hash))) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    // c. Si las credenciales son válidas, crea el payload del token
    const payload = {
      sub: user.id,
      email: user.email,
      // aquí puedes añadir más datos si quieres, como roles
    };

    // d. Firma el token y lo devuelve
    return {
      access_token: await this.jwt.signAsync(payload),
    };
  }


  // --- El método signUp se mantiene igual ---
  async signUp(data: Prisma.UserCreateInput): Promise<Omit<User, 'password_hash'>> {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(data.password_hash, saltRounds);

    try {
      const user = await this.prisma.user.create({
        data: {
          ...data,
          password_hash: hashedPassword,
        },
      });

      const { password_hash, ...result } = user;
      return result;

    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('El correo electrónico ya está registrado.');
      }
      throw error;
    }
  }
}