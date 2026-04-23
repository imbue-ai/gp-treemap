/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import <Foundation/Foundation.h>

#import "TextOutput.h"

const NSUInteger TEXT_OUTPUT_BUFFER_SIZE = 4096 * 16;


@implementation TextOutput

- (void) dealloc {
  if (file) {
    fclose(file);
    file = NULL;
  }
  [_path release];

  free(dataBuffer);

  [super dealloc];
}

- (instancetype) initWithPath:(NSURL *)pathVal {
  if (self = [super init]) {
    _path = [pathVal retain];
    file = NULL;
    dataBuffer = malloc(TEXT_OUTPUT_BUFFER_SIZE);
  }
  return self;
}

- (BOOL) open {
  file = fopen(self.path.path.UTF8String, "w");

  return file != NULL;
}

- (BOOL) close {
  BOOL ok = fclose(file) == 0;

  file = NULL;

  return ok;
}

- (BOOL) appendString:(NSString *)s {
  NSData  *newData = [s dataUsingEncoding: NSUTF8StringEncoding];
  const void  *newDataBytes = newData.bytes;
  NSUInteger  numToAppend = newData.length;
  NSUInteger  newDataPos = 0;

  while (numToAppend > 0) {
    NSUInteger  numToCopy = (dataBufferPos + numToAppend <= TEXT_OUTPUT_BUFFER_SIZE
                             ? numToAppend
                             : TEXT_OUTPUT_BUFFER_SIZE - dataBufferPos);

    memcpy(dataBuffer + dataBufferPos, newDataBytes + newDataPos, numToCopy);
    dataBufferPos += numToCopy;
    newDataPos += numToCopy;
    numToAppend -= numToCopy;

    if (dataBufferPos == TEXT_OUTPUT_BUFFER_SIZE && ![self flush]) {
      return NO;
    }
  }

  return YES;
}

- (BOOL) flush {
  if (dataBufferPos > 0) {
    // Write remaining characters in buffer
    NSUInteger  numWritten = fwrite(dataBuffer, 1, dataBufferPos, file);

    if (numWritten != dataBufferPos) {
      NSLog(@"Failed to write text data: %lu bytes written out of %lu.",
            (unsigned long)numWritten, (unsigned long)dataBufferPos);
      return NO;
    }

    dataBufferPos = 0;
  }

  return YES;
}

@end // @implementation TextOutput
