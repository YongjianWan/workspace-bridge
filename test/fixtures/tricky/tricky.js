@Controller('users')
export class UserController {
  @Get(':id')
  async getUser(@Param('id') id: string) {
    const service = await import('./user-service');
    return service.getUser(id);
  }
}
const { legacyInit } = require('./legacy');
module.exports = { UserController };
